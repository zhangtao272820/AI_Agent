import { collectCandidates as collectCandidatesFromModule } from './candidateTools'

type ExecuteClickCandidateContext = {
  action: any
  state: any
  session: any
  params: any
  stepCount: number
  pageUrlBefore: string
  extractedCountBefore: number
  confirmCountNext: number
  resolveCandidate: (index: number) => any
  setRuntimeCandidates: (arr: any[]) => void
  getRuntimeCandidates: () => any[]
  candidateLocator: (index: number, kind: 'click' | 'type') => any
  uniqueLocator: (loc: any) => Promise<any>
  elementAtCandidatePointLooksRight: (candidate: any) => Promise<boolean>
  intentFromReason: (reason: any) => string
  verifyIntentSatisfied: (page: any, intent: string, opts: any) => Promise<boolean>
  verifyOpts: () => any
  tryDismissOverlays: (page: any) => Promise<any>
  applyActionPolicy: (meta: any) => Promise<any>
  buildStableTextRegex: (text: string) => RegExp | null
  escapeRegExp: (s: string) => string
  adoptPopup: (session: any, popup: any) => Promise<any>
  normalizeUrlForCompare: (url: string) => string
  collectToastText: (page: any) => Promise<string>
  pageSnapshot: (page: any) => Promise<any>
  pushState: (nextState: any) => void
  buildEndMeta: (meta: any) => Promise<any>
  textDigest: (text: string) => string
  emitStepEnd: (meta: any) => void
  getConfirmState: () => { confirmCountNext: number; lastConfirmedActionKey: string; lastConfirmAt: number }
}

export async function executeClickCandidate(ctx: ExecuteClickCandidateContext) {
  const {
    action,
    state,
    session,
    params,
    stepCount,
    pageUrlBefore,
    extractedCountBefore,
    confirmCountNext,
    resolveCandidate,
    setRuntimeCandidates,
    getRuntimeCandidates,
    candidateLocator,
    uniqueLocator,
    elementAtCandidatePointLooksRight,
    intentFromReason,
    verifyIntentSatisfied,
    verifyOpts,
    tryDismissOverlays,
    applyActionPolicy,
    buildStableTextRegex,
    escapeRegExp,
    adoptPopup,
    normalizeUrlForCompare,
    collectToastText,
    pageSnapshot,
    pushState,
    buildEndMeta,
    textDigest,
    emitStepEnd,
    getConfirmState
  } = ctx

  const requestedIdx = Number((action as any).index)
  let idx = Number.isFinite(requestedIdx) ? Math.max(0, Math.floor(requestedIdx)) : -1
  let c: any = resolveCandidate(idx)
  let loc = await uniqueLocator(candidateLocator(idx, 'click'))
  if (!c || !loc) {
    const old = c && typeof c === 'object' ? { ...c } : null
    const refreshed = await collectCandidatesFromModule(session!.page, Math.max(40, idx + 12)).catch(() => [] as any[])
    if (Array.isArray(refreshed) && refreshed.length) {
      setRuntimeCandidates(refreshed)
      try {
        params.emit({ type: 'candidates', payload: refreshed })
      } catch {}
    }
    const list = getRuntimeCandidates()
    const byCid = old ? list.findIndex((x) => String((x as any)?.cid || '').trim() && String((x as any)?.cid || '').trim() === String((old as any)?.cid || '').trim()) : -1
    const byHref = byCid < 0 && old ? list.findIndex((x) => String((x as any)?.href || '').trim() && String((x as any)?.href || '').trim() === String((old as any)?.href || '').trim()) : -1
    const byLabel =
      byCid < 0 && byHref < 0 && old
        ? list.findIndex((x) => String((x as any)?.label || '').replace(/\s+/g, ' ').trim() === String((old as any)?.label || '').replace(/\s+/g, ' ').trim())
        : -1
    if (byCid >= 0) idx = byCid
    else if (byHref >= 0) idx = byHref
    else if (byLabel >= 0) idx = byLabel
    else if (idx >= 0 && list.length > 0) idx = Math.min(list.length - 1, idx)
    c = resolveCandidate(idx)
    loc = await uniqueLocator(candidateLocator(idx, 'click'))
  }
  if (!c) throw new Error(`click_candidate 索引无效：${String((action as any).index ?? '')}; candidates=${getRuntimeCandidates().length}`)
  const label = String(c.label || '').trim()
  const intent = intentFromReason((action as any).reason)
  const intentSatisfiedBefore = intent ? await verifyIntentSatisfied(session!.page, intent, { ...verifyOpts(), attempts: 1 }).catch(() => false) : false
  await tryDismissOverlays(session!.page).catch(() => {})
  const riskMeta = await applyActionPolicy({ actionType: 'click_candidate', intent, label, selector: String(c?.selector || ''), href: String(c?.href || '') })
  const popupPromise = session!.page.waitForEvent('popup', { timeout: 2500 }).catch(() => null)
  if (loc) {
    await loc.scrollIntoViewIfNeeded().catch(() => {})
  }
  const clickByBbox = async () => {
    const hitOk = await elementAtCandidatePointLooksRight(c)
    if (!hitOk) return false
    const b = c?.bbox && typeof c.bbox === 'object' ? c.bbox : null
    if (!b) return false
    const x = Number(b.x)
    const y = Number(b.y)
    const w = Number(b.width)
    const h = Number(b.height)
    if (![x, y, w, h].every((n) => Number.isFinite(n))) return false
    const vp = session!.page.viewportSize?.() as any
    const maxX = Number(vp?.width || 1280) - 2
    const maxY = Number(vp?.height || 720) - 2
    const cx = Math.max(2, Math.min(maxX, Math.floor(x + Math.max(0, w) / 2)))
    const cy = Math.max(2, Math.min(maxY, Math.floor(y + Math.max(0, h) / 2)))
    await session!.page.mouse.move(cx, cy).catch(() => {})
    await session!.page.mouse.click(cx, cy).catch(() => {})
    return true
  }

  let clickErr = ''
  const clickTimeoutMs = 2500
  const clicked = loc
    ? await loc
        .click({ timeout: clickTimeoutMs })
        .then(() => true)
        .catch((e: any) => {
          clickErr = e?.message ? String(e.message) : String(e)
          return false
        })
    : false
  if (!loc && !clickErr) clickErr = 'locator_not_found'
  if (!clicked) {
    const href = String(c?.href || '').trim()
    const ok = await clickByBbox().catch(() => false)
    if (!ok && href && /^https?:\/\//i.test(href)) {
      await session!.page.goto(href, { waitUntil: 'domcontentloaded' }).catch(() => {})
    } else if (!ok && label) {
      throw new Error(`page.click failed: ${clickErr || 'unknown'}; candidate=${String((action as any).index ?? '')}; label=${label}`)
    } else if (!ok) {
      throw new Error(`page.click failed: ${clickErr || 'unknown'}; candidate=${String((action as any).index ?? '')}; label=${label}`)
    }
  }
  const popup = await popupPromise
  await adoptPopup(session, popup)
  const waitForNav = async () => {
    try {
      const href = String(c?.href || '').trim()
      const beforeNorm = normalizeUrlForCompare(pageUrlBefore)
      if (href && /^https?:\/\//i.test(href)) {
        await session!.page
          .waitForURL((u: any) => normalizeUrlForCompare(String(u)) !== beforeNorm, { timeout: 4000 })
          .catch(() => {})
      }
      await session!.page.waitForLoadState('domcontentloaded', { timeout: 2500 }).catch(() => {})
    } catch {}
  }
  await waitForNav()
  await session!.page.waitForTimeout(250)
  const toastAfter = intent ? await collectToastText(session!.page).catch(() => '') : ''
  const intentSatisfiedAfter = intent ? await verifyIntentSatisfied(session!.page, intent, { ...verifyOpts(), attempts: 2, waitMs: 500 }).catch(() => false) : false
  const snap = await pageSnapshot(session!.page)
  params.emit({ type: 'screenshot', payload: { dataUrl: snap.dataUrl, ts: Date.now() } })
  pushState({ ...state, phase: 'acting', stepCount, pageUrl: snap.url, lastClickCandidateIndex: idx })
  const endMeta = await buildEndMeta({
    ok: true,
    type: 'click_candidate',
    index: idx,
    label,
    targetHrefExpected: String(c?.href || '').trim(),
    targetLabelExpected: label,
    targetContextExpected: String(c?.contextText || '').trim(),
    pageUrlBefore,
    pageUrlAfter: snap.url,
    pageTitleAfter: snap.title,
    pageTextAfter: snap.text,
    pageTextHashAfter: textDigest(snap.text),
    pageTextLenAfter: snap.text.length,
    ...(intent ? { intent, intentSatisfiedBefore, intentSatisfiedAfter, toastAfter } : {}),
    risk: riskMeta
  })
  emitStepEnd(endMeta)
  const confirmState = getConfirmState()
  return {
    stepCount,
    phase: 'acting',
    pageUrl: snap.url,
    pageTitle: snap.title,
    pageText: snap.text,
    screenshotDataUrl: snap.dataUrl,
    route: 'verify',
    lastStepMeta: endMeta,
    failureType: '',
    extractedCountBefore,
    lastClickCandidateIndex: idx,
    confirmCount: confirmState.confirmCountNext,
    lastConfirmedActionKey: confirmState.lastConfirmedActionKey,
    lastConfirmAt: confirmState.lastConfirmAt
  }
}
