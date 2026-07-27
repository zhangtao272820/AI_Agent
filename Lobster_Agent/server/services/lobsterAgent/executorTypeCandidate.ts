type ExecuteTypeCandidateContext = {
  action: any
  state: any
  session: any
  params: any
  stepCount: number
  pageUrlBefore: string
  extractedCountBefore: number
  confirmCountNext: number
  resolveCandidate: (index: number) => any
  candidateLocator: (index: number, kind: 'click' | 'type') => any
  uniqueLocator: (loc: any) => Promise<any>
  applyActionPolicy: (meta: any) => Promise<any>
  intentFromReason: (reason: any) => string
  adoptPopup: (session: any, popup: any) => Promise<any>
  pageSnapshot: (page: any) => Promise<any>
  pushState: (nextState: any) => void
  buildEndMeta: (meta: any) => Promise<any>
  textDigest: (text: string) => string
  emitStepEnd: (meta: any) => void
  getConfirmState: () => { confirmCountNext: number; lastConfirmedActionKey: string; lastConfirmAt: number }
}

export async function executeTypeCandidate(ctx: ExecuteTypeCandidateContext) {
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
    candidateLocator,
    uniqueLocator,
    applyActionPolicy,
    intentFromReason,
    adoptPopup,
    pageSnapshot,
    pushState,
    buildEndMeta,
    textDigest,
    emitStepEnd,
    getConfirmState
  } = ctx

  const rawText = String((action as any).text || '')
  const wantsEnter = /\n$/.test(rawText) || /\{enter\}$/i.test(rawText.trim())
  const text = rawText.replace(/\{enter\}$/i, '').replace(/\n+$/g, '')
  const idx = Number((action as any).index)
  const c: any = resolveCandidate(idx)
  const loc = await uniqueLocator(candidateLocator(idx, 'type'))
  if (!c || !loc) throw new Error(`type_candidate 索引无效：${String((action as any).index ?? '')}`)
  const label = String(c.label || '').trim()
  await loc.scrollIntoViewIfNeeded().catch(() => {})
  const filled = await loc.fill(text, { timeout: 2500 }).then(() => true).catch(() => false)
  if (!filled) throw new Error(`page.fill: Timeout; candidate=${String((action as any).index ?? '')}; label=${label}`)
  const riskMeta = wantsEnter ? await applyActionPolicy({ actionType: 'type_candidate_submit', intent: intentFromReason((action as any).reason), label, selector: String(c?.selector || '') }) : null
  if (wantsEnter) {
    const popupPromise = session!.page.waitForEvent('popup', { timeout: 2500 }).catch(() => null)
    await session!.page.keyboard.press('Enter').catch(() => {})
    const popup = await popupPromise
    await adoptPopup(session, popup)
  }
  await session!.page.waitForTimeout(250)
  const snap = await pageSnapshot(session!.page)
  params.emit({ type: 'screenshot', payload: { dataUrl: snap.dataUrl, ts: Date.now() } })
  pushState({ ...state, phase: 'acting', stepCount, pageUrl: snap.url })
  const endMeta = await buildEndMeta({
    ok: true,
    type: 'type_candidate',
    index: idx,
    label,
    textLen: text.length,
    pageUrlBefore,
    pageUrlAfter: snap.url,
    pageTitleAfter: snap.title,
    pageTextHashAfter: textDigest(snap.text),
    pageTextLenAfter: snap.text.length,
    ...(riskMeta ? { risk: riskMeta } : {})
  })
  emitStepEnd(endMeta)
  const isCommentInput = /评论|说点什么|回复|请输入/i.test(`${String(c?.label || '')} ${String(c?.placeholder || '')}`)
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
    confirmCount: confirmState.confirmCountNext,
    lastConfirmedActionKey: confirmState.lastConfirmedActionKey,
    lastConfirmAt: confirmState.lastConfirmAt,
    ...(isCommentInput && text ? { lastCommentText: text } : {})
  }
}
