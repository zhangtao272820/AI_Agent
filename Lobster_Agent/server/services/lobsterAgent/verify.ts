import type { GraphNode } from '@langchain/langgraph'
import {
  bilibiliSearchUrl,
  isBilibiliGuestTask,
  bilibiliDirectSearchIntent,
  baiduNeedsDirectSearch,
  baiduDirectSearchIntent
} from './taskLoginIntent'
import {
  evaluateSuccessCriteria,
  mergeSuccessCriteria,
  parseSuccessCriteria,
  resultPageHintsFor,
} from '../lobsterSuccessCriteria'
import { isClassicGoalsHeuristicEnabled } from '../classicStepDecideSchema'

/**
 * 播放后互动队列。优先 TaskSpec.wantedInteractionOps；
 * 仅 LOBSTER_CLASSIC_GOALS_HEURISTIC=1 时才用用户原话 regex（冷启动兼容）。
 */
export function buildPendingEngagementSeq(
  state: any,
  forbidden: Set<string>,
  allowed: Set<string>,
  clipSeq: (seq: any[]) => any[],
) {
  const seq: any[] = []
  const can = (it: string) => !forbidden.has(it) && (!allowed.size || allowed.has(it))
  const wantedRaw = Array.isArray((state as any)?.taskSpec?.wantedInteractionOps)
    ? ((state as any).taskSpec.wantedInteractionOps as any[]).map((x) => String(x || '').trim().toLowerCase())
    : []
  const wanted = new Set(wantedRaw.filter(Boolean))
  const heuristicOn = isClassicGoalsHeuristicEnabled()
  const t = String(state?.task || '')
  const want = (op: string, re: RegExp) => wanted.has(op) || (heuristicOn && re.test(t))
  if (can('like') && want('like', /点赞|\blike\b|(^|\b)赞(?!助)\b/i)) {
    seq.push({ intent: 'like', reason: '目标阶段：执行点赞' })
  }
  if (can('coin') && want('coin', /投币|\bcoin\b/i)) {
    seq.push({ intent: 'coin', reason: '目标阶段：执行投币' })
  }
  if (can('follow') && want('follow', /关注|\bfollow\b|\bsubscribe\b|订阅/i)) {
    seq.push({ intent: 'follow', reason: '目标阶段：执行关注' })
  }
  if (can('favorite') && want('favorite', /收藏|\bfavorite\b|\bstar\b/i)) {
    seq.push({ intent: 'favorite', reason: '目标阶段：执行收藏' })
  }
  return clipSeq(seq)
}

export function createNodeVerify(deps: any): GraphNode<any> {
  const {
    ensureNotAborted,
    waitWhilePaused,
    session,
    emitLog,
    allowRiskyRecoveryClicks,
    collectPageSignals,
    detectVideoPlaybackStateDeep,
    normalizeUrlForCompare,
    pickAdapterKey,
    pickGenericFirstResultCandidateIndex,
    pickCandidateIndexByIntent,
    looksLikeLoginUrl,
    getForcedIntents,
    parseQueryFromTask,
    maxForcedIntentsTotal,
    maxForcedIntentsPerFailure
  } = deps

  const stopNeedHuman = (reason: string) => {
    const msg = `需要人工介入：${String(reason || '恢复预算已用尽')}。已停止自动尝试，避免误操作。`
    emitLog('error', msg)
    return {
      phase: 'verifying',
      error: msg,
      failureType: 'need_human',
      stage: 'done',
      forcedIntents: [],
      forcedIntentsExpireAt: 0,
      forcedIntentsUsed: 0,
      forcedIntentsSource: '',
      route: 'end'
    }
  }

  const nodeVerify: GraphNode<any> = async (state) => {
    ensureNotAborted()
    await waitWhilePaused()
    const action = state.action as any
    const stepCount = Number(state.stepCount || 0)

    const urlNow = String(state.pageUrl || '')
    const ignoreLimitForVideo = !!state.waitForVideoEnd
    const doneByLimit = !ignoreLimitForVideo && stepCount >= Number(state.maxSteps || 20)
    if (doneByLimit) {
      emitLog('warn', `达到最大步数限制：${state.maxSteps}，结束任务`)
      return { phase: 'verifying', route: 'end' }
    }

    if (action?.type === 'need_crawl') return { phase: 'verifying', route: 'crawler' }
    if (action?.type === 'wait' && !!state.waitForVideoEnd) {
      return { phase: 'verifying', route: 'decision' }
    }

    const meta: any = (state as any).lastStepMeta
    const before = meta?.pageUrlBefore ? String(meta.pageUrlBefore) : ''
    const after = meta?.pageUrlAfter ? String(meta.pageUrlAfter) : String(state.pageUrl || '')
    const urlChanged =
      normalizeUrlForCompare(before) && normalizeUrlForCompare(after) && normalizeUrlForCompare(before) !== normalizeUrlForCompare(after)
    const beforeTitle = String(meta?.pageTitleBefore || '')
    const afterTitle = String(meta?.pageTitleAfter || '')
    const titleChanged = beforeTitle && afterTitle && beforeTitle !== afterTitle
    const beforeHash = String(meta?.pageTextHashBefore || '')
    const afterHash = String(meta?.pageTextHashAfter || '')
    const textChanged = beforeHash && afterHash && beforeHash !== afterHash
    const afterSig = await collectPageSignals(session.page)
    const beforeH1 = String(meta?.h1TextBefore || '').trim()
    const afterH1 = String(afterSig.h1Text || '').trim()
    const h1Changed = !!beforeH1 && !!afterH1 && beforeH1 !== afterH1
    const beforeHasVideo = !!meta?.hasVideoBefore
    const afterHasVideo = !!afterSig.hasVideo
    const videoChanged = beforeHasVideo !== afterHasVideo
    const beforeLinkCount = Number(meta?.linkCountBefore ?? 0)
    const afterLinkCount = Number(afterSig.linkCount ?? 0)
    const linkCountChanged =
      Number.isFinite(beforeLinkCount) &&
      Number.isFinite(afterLinkCount) &&
      ((beforeLinkCount >= 8 && afterLinkCount >= 0 && Math.abs(afterLinkCount - beforeLinkCount) >= 6) ||
        (beforeLinkCount >= 12 && afterLinkCount > 0 && afterLinkCount <= beforeLinkCount * 0.6))
    const href0 = String(meta?.firstLinkHrefBefore || '').trim()
    const href1 = String(afterSig.firstLinkHref || '').trim()
    const firstLinkChanged = !!href0 && !!href1 && href0 !== href1
    const q0 = String(meta?.searchValueBefore || '').trim()
    const q1 = String(afterSig.searchValue || '').trim()
    const searchChanged = !!q0 && !!q1 && q0 !== q1
    const signalChanged = h1Changed || videoChanged || linkCountChanged || firstLinkChanged || searchChanged
    const semanticChanged = titleChanged || textChanged || signalChanged
    const changed = urlChanged || semanticChanged

    const adapterKey = pickAdapterKey(String(after || urlNow || ''))
    const pageForMedia = String(after || urlNow || '')

    const vj = (state as any).visionJson
    const visionPageType = vj && typeof vj === 'object' ? String((vj as any).pageType || '').toLowerCase() : ''
    const visionHasPlayer = vj && typeof vj === 'object' ? !!(vj as any).hasPlayer : false
    const visionHasOverlay = vj && typeof vj === 'object' ? !!(vj as any).hasOverlay : false

    const urlNorm = normalizeUrlForCompare(String(after || urlNow || ''))
    const lcBucket = Number.isFinite(afterLinkCount) && afterLinkCount > 0 ? Math.floor(afterLinkCount / 10) * 10 : 0
    const songFp = ''
    const fp = [
      urlNorm ? `u=${urlNorm}` : 'u=',
      songFp ? `song=${songFp}` : 'song=',
      afterHash ? `h=${afterHash}` : 'h=',
      afterH1 ? `h1=${afterH1.slice(0, 50)}` : 'h1=',
      afterTitle ? `t=${afterTitle.slice(0, 70)}` : 't=',
      `lc=${lcBucket}`,
      `v=${afterHasVideo ? 1 : 0}`,
      visionPageType ? `pt=${visionPageType}` : 'pt='
    ].join('|')
    const fpPrev = Array.isArray((state as any).fingerprintSeq) ? ((state as any).fingerprintSeq as any[]).map(String).filter(Boolean) : []
    const fingerprintSeq = [...fpPrev, fp].slice(-12)
    const fpPatch = { pageFingerprint: fp, fingerprintSeq }
    const withFp = (o: any) => ({ ...o, ...fpPatch })

    const stageNow0 = String((state as any).stage || '')
    const watchUntilAt0 = Math.max(0, Math.floor(Number((state as any).watchUntilAt || 0)))
    if ((stageNow0 === 'watch' || stageNow0 === 'play') && watchUntilAt0 > 0 && Date.now() < watchUntilAt0 && action?.type === 'done') {
      const remaining = Math.max(200, Math.min(120000, watchUntilAt0 - Date.now()))
      const now = Date.now()
      return withFp({
        phase: 'verifying',
        stallCount: 0,
        stage: 'watch',
        forcedIntents: [{ intent: 'wait', args: { ms: remaining }, reason: '目标守卫：观看计时中，禁止提前结束，等待到点' }],
        forcedIntentsExpireAt: now + 60_000,
        forcedIntentsUsed: 0,
        forcedIntentsSource: 'verify',
        route: 'decision'
      })
    }

    if (!!state.waitForVideoEnd) {
      const looksVideo = afterHasVideo || visionHasPlayer || false
      if (looksVideo) {
        const st = await detectVideoPlaybackStateDeep(session.page).catch(() => null as any)
        const ended =
          !!st?.hasVideo &&
          (!!st.ended || (Number.isFinite(st.duration) && st.duration > 0 && Number.isFinite(st.currentTime) && st.currentTime >= st.duration - 0.4))
        if (ended) {
          emitLog('info', '目标阶段：视频已播放结束，结束任务')
          return withFp({
            phase: 'verifying',
            stallCount: 0,
            stage: 'done',
            forcedIntents: [],
            forcedIntentsExpireAt: 0,
            forcedIntentsUsed: 0,
            forcedIntentsSource: '',
            route: 'end'
          })
        }
        if (action?.type === 'done') {
          const now = Date.now()
          return withFp({
            phase: 'verifying',
            stallCount: 0,
            stage: 'watch',
            forcedIntents: [{ intent: 'wait', args: { ms: 1000 }, reason: '目标守卫：任务要求看完再关，禁止提前结束，等待播放结束' }],
            forcedIntentsExpireAt: now + 90_000,
            forcedIntentsUsed: 0,
            forcedIntentsSource: 'verify',
            route: 'decision'
          })
        }
      }
    }

    // 模型显式 { type: 'done' } / intent done：应结束 LangGraph，否则会落到文末「继续下一轮感知」形成死循环。
    // 例外已由上文处理：观看倒计时未结束、以及「看完再关」且视频未结束。
    if (action?.type === 'done') {
      emitLog('info', '验证：已执行 done，结束任务')
      return withFp({
        phase: 'verifying',
        stallCount: 0,
        stage: 'done',
        route: 'end',
        forcedIntents: [],
        forcedIntentsExpireAt: 0,
        forcedIntentsUsed: 0,
        forcedIntentsSource: ''
      })
    }

    const intent = String(meta?.intent || '')
    const extractedBefore = Math.max(0, Math.floor(Number((state as any).extractedCountBefore || 0)))
    const extractedNow = Math.max(0, Math.floor(Number((state as any).extractedCount || 0)))
    const dataProgress = extractedNow > extractedBefore
    const progressScore = Math.max(0, Math.min(1, Number(meta?.progress?.score ?? (meta as any)?.progressScore ?? 0)))
    const expectedHref = String(meta?.targetHrefExpected || '').trim()
    const expectedLabel = String(meta?.targetLabelExpected || '').trim().toLowerCase()
    const expectedContext = String(meta?.targetContextExpected || '').trim().toLowerCase()
    const targetMatched =
      !!meta?.intentSatisfiedAfter ||
      (!!expectedHref && normalizeUrlForCompare(after).includes(normalizeUrlForCompare(expectedHref))) ||
      (!!expectedLabel &&
        [`${String(afterTitle || '')} ${String(afterH1 || '')} ${String(meta?.pageTextAfter || '')}`.toLowerCase(), String((state as any).pageText || '').toLowerCase()]
          .join('\n')
          .includes(expectedLabel.slice(0, 40))) ||
      (!!expectedContext && String((state as any).pageText || '').toLowerCase().includes(expectedContext.slice(0, 60)))
    const progressStrong =
      dataProgress || progressScore >= 0.55 || semanticChanged || targetMatched
    const prevStall = Math.max(0, Math.floor(Number((state as any).stallCount || 0)))
    const stageNowForStall = String((state as any).stage || '')
    const allowWaitStall = action?.type === 'wait' && (stageNowForStall === 'watch' || stageNowForStall === 'play') && progressScore < 0.2
    const stallInc =
      !progressStrong && action?.type !== 'done' && (action?.type !== 'wait' || allowWaitStall)
        ? 1
        : 0
    const stallCount = stallInc ? prevStall + 1 : 0
    const taskSpec = (state as any).taskSpec && typeof (state as any).taskSpec === 'object' ? (state as any).taskSpec : {}
    const normalizeIt = (it: any) => {
      const s = String(it || '').trim()
      if (!s) return ''
      if (s === 'extract') return 'extract_items'
      if (s === 'next') return 'paginate_next'
      return s
    }
    const allowed = new Set(
      (Array.isArray((taskSpec as any).allowedIntents) ? (taskSpec as any).allowedIntents : []).map(normalizeIt).filter(Boolean)
    )
    const forbidden = new Set(
      (Array.isArray((taskSpec as any).forbiddenIntents) ? (taskSpec as any).forbiddenIntents : []).map(normalizeIt).filter(Boolean)
    )
    const isAllowed = (it: string) => !allowed.size || allowed.has(it)
    const clipSeq = (seq: any[]) =>
      (Array.isArray(seq) ? seq : []).filter((x) => {
        const it = normalizeIt(x?.intent)
        if (!it) return false
        if (!isAllowed(it)) return false
        if (forbidden.has(it)) return false
        return true
      })
    const forcedExisting = Array.isArray((state as any).forcedIntents) ? ((state as any).forcedIntents as any[]).filter(Boolean) : []
    const forcedCountsRaw =
      (state as any).forcedInjectCounts && typeof (state as any).forcedInjectCounts === 'object' ? { ...(state as any).forcedInjectCounts } : {}
    const forcedTotalRaw = Math.max(0, Math.floor(Number((state as any).forcedInjectTotal || 0)))
    const maxTotal = Math.max(0, Math.floor(Number(maxForcedIntentsTotal ?? 10)))
    const maxPerFailure = Math.max(0, Math.floor(Number(maxForcedIntentsPerFailure ?? 2)))
    const tryBumpForced = (key: string) => {
      const k = String(key || 'forced')
      const used = Math.max(0, Math.floor(Number((forcedCountsRaw as any)[k] || 0)))
      if (maxTotal === 0) return { ok: false as const, error: 'forced_disabled' }
      if (forcedTotalRaw >= maxTotal) return { ok: false as const, error: 'forced_total_exceeded' }
      if (used >= maxPerFailure) return { ok: false as const, error: 'forced_per_failure_exceeded' }
      return {
        ok: true as const,
        patch: {
          forcedInjectCounts: { ...forcedCountsRaw, [k]: used + 1 },
          forcedInjectTotal: forcedTotalRaw + 1
        }
      }
    }
    const sameUrlCountState = Math.max(0, Math.floor(Number((state as any).sameUrlCount || 0)))
    const sameActionCountState = Math.max(0, Math.floor(Number((state as any).sameActionCount || 0)))
    const seqState = Array.isArray((state as any).actionSeq) ? ((state as any).actionSeq as any[]).map(String).filter(Boolean) : []
    const repeatedNgram = (seq: string[], n: number) => {
      if (seq.length < n * 2) return false
      const a = seq.slice(-n).join('\n')
      const b = seq.slice(-n * 2, -n).join('\n')
      return !!a && a === b
    }
    const actionLoop = repeatedNgram(seqState, 2) || repeatedNgram(seqState, 3) || repeatedNgram(seqState, 4)
    const fpStable = fingerprintSeq.length >= 2 && fingerprintSeq[fingerprintSeq.length - 1] === fingerprintSeq[fingerprintSeq.length - 2]
    const fpLoop = repeatedNgram(fingerprintSeq, 2) || repeatedNgram(fingerprintSeq, 3) || repeatedNgram(fingerprintSeq, 4)
    const loopBySeq = actionLoop && (fpStable || fpLoop)
    const shouldForceRecover =
      stallCount >= 3 ||
      (stallCount >= 2 && (sameUrlCountState >= 2 || sameActionCountState >= 2 || loopBySeq)) ||
      (loopBySeq && stallCount >= 1)
    if (!forcedExisting.length && shouldForceRecover) {
      const hint = `${String((state as any).visionSummary || '')}\n${String((state as any).pageTitle || '')}\n${String(
        (state as any).pageText || ''
      )}`.slice(0, 1400)
      const seq = clipSeq(getForcedIntents('stall', { hint, allowRiskyRecoveryClicks: !!allowRiskyRecoveryClicks }))
      const bump = tryBumpForced('stall')
      if (!bump.ok) {
        return withFp(stopNeedHuman(`stall (${bump.error})`))
      }
      emitLog(
        'warn',
        `停滞检测：stallCount=${stallCount} sameUrl=${sameUrlCountState} sameAction=${sameActionCountState} loopBySeq=${loopBySeq ? 1 : 0} fpStable=${fpStable ? 1 : 0}，进入强制恢复策略`
      )
      return withFp({
        phase: 'verifying',
        stallCount,
        forcedIntents: seq as any,
        forcedIntentsExpireAt: Date.now() + 45_000,
        forcedIntentsUsed: 0,
        forcedIntentsSource: 'verify',
        ...(bump.patch || {}),
        route: 'decision'
      })
    }

    const goalsRaw = (state as any).goals
    const goals = goalsRaw && typeof goalsRaw === 'object' ? goalsRaw : {}
    const mustSearch = !!(goals as any).mustSearch
    const mustEnterDetail = !!(goals as any).mustEnterDetail
    const mustExtract = !!(goals as any).mustExtract
    const mustReturnToListBeforeExtract = !!(goals as any).mustReturnToListBeforeExtract
    const extractLimitRaw = Number((goals as any).extractLimit || 0)
    const extractLimit = Number.isFinite(extractLimitRaw) && extractLimitRaw > 0 ? Math.floor(extractLimitRaw) : 0
    const goalActive = mustSearch || mustEnterDetail || mustExtract
    let stage = String((state as any).stage || '')
    if (!stage) stage = mustSearch ? 'search' : mustEnterDetail ? 'enter_detail' : mustExtract ? 'extract' : 'done'

    const now = Date.now()
    const watchSeconds = Math.max(0, Math.floor(Number((state as any).watchSeconds || 0)))
    const watchUntilAt = Math.max(0, Math.floor(Number((state as any).watchUntilAt || 0)))
    const watchAnchorUrl = String((state as any).watchAnchorUrl || '').trim()
    const normalizeWatchAnchor = (u: string) => normalizeUrlForCompare(String(u || '').trim())
    const currentVideoUrl = String(after || urlNow || '')
    const currentAnchor = normalizeWatchAnchor(currentVideoUrl)
    const anchorNorm = normalizeWatchAnchor(watchAnchorUrl)
    const forcedMetaBase = { forcedIntentsUsed: 0, forcedIntentsSource: 'verify' }

    const wantsTimedWatch = watchSeconds > 0
    const wantsWaitEnd = !!state.waitForVideoEnd
    const looksVideoPage =
      afterHasVideo ||
      visionHasPlayer ||
      visionPageType === 'detail' ||
      false
    if (stage === 'watch' && anchorNorm && currentAnchor && currentAnchor !== anchorNorm) {
      const stillWatching = (wantsTimedWatch && watchUntilAt > now && now < watchUntilAt) || wantsWaitEnd
      if (stillWatching) {
        emitLog('warn', `观看守卫：检测到自动跳到其他视频（from=${anchorNorm} to=${currentAnchor}），回到目标视频继续观看`)
        const remain = wantsTimedWatch && watchUntilAt > now ? Math.max(200, Math.min(120000, watchUntilAt - now)) : 1000
        const seq = clipSeq([
          { intent: 'goto', args: { url: anchorNorm }, reason: '观看守卫：回到首次进入的视频' },
          { intent: 'wait', args: { ms: remain }, reason: wantsTimedWatch ? '观看守卫：回到目标视频后继续计时' : '观看守卫：回到目标视频后继续等待' }
        ] as any)
        return withFp({
          phase: 'verifying',
          stallCount: 0,
          stage: 'watch',
          forcedIntents: seq as any,
          forcedIntentsExpireAt: Math.max(now + 45_000, watchUntilAt > 0 ? watchUntilAt + 10_000 : now + 90_000),
          ...forcedMetaBase,
          route: 'decision',
          watchAnchorUrl: anchorNorm
        })
      }
    }

    if (looksVideoPage && (wantsTimedWatch || wantsWaitEnd) && stage !== 'watch') {
      const until = wantsTimedWatch ? (watchUntilAt > 0 ? watchUntilAt : now + watchSeconds * 1000) : 0
      const waitMs = wantsTimedWatch ? Math.max(200, Math.min(120000, until - now)) : 1000
      const nextAnchor = anchorNorm || currentAnchor
      const seq = [
        { intent: 'play', reason: '目标阶段：开始播放' },
        { intent: 'wait', args: { ms: waitMs }, reason: wantsTimedWatch ? `目标阶段：观看${watchSeconds}秒` : '目标阶段：等待播放至结束' }
      ]
      return withFp({
        phase: 'verifying',
        stallCount: 0,
        stage: 'watch',
        forcedIntents: seq as any,
        forcedIntentsExpireAt: Math.max(now + 60_000, until > 0 ? until + 10_000 : now + 90_000),
        ...forcedMetaBase,
        route: 'decision',
        watchSeconds,
        watchUntilAt: until,
        watchAnchorUrl: nextAnchor
      })
    }

    if (goalActive && stage === 'watch' && watchUntilAt > 0) {
      if (Date.now() >= watchUntilAt) {
        const engageSeq = buildPendingEngagementSeq(state, forbidden, allowed, clipSeq)
        if (engageSeq.length) {
          emitLog('info', '目标阶段：观看完成，继续执行互动操作')
          return withFp({
            phase: 'verifying',
            stallCount: 0,
            stage: 'play',
            forcedIntents: engageSeq as any,
            forcedIntentsExpireAt: now + 45_000,
            ...forcedMetaBase,
            route: 'decision',
            watchUntilAt: 0
          })
        }
        const nextStage = mustExtract ? (mustReturnToListBeforeExtract ? 'return_list' : 'extract') : 'done'
        if (nextStage === 'done') {
          emitLog('info', '目标阶段：已观看到指定时长，结束任务')
          return withFp({
            phase: 'verifying',
            stallCount: 0,
            stage: 'done',
            route: 'end',
            watchUntilAt: 0,
            forcedIntents: [],
            forcedIntentsExpireAt: 0,
            forcedIntentsUsed: 0,
            forcedIntentsSource: ''
          })
        }
        emitLog('info', `目标阶段：已观看到指定时长，切换到 stage=${nextStage}`)
        return withFp({
          phase: 'verifying',
          stallCount: 0,
          stage: nextStage,
          route: 'decision',
          watchUntilAt: 0,
          forcedIntents: [],
          forcedIntentsExpireAt: 0,
          forcedIntentsUsed: 0,
          forcedIntentsSource: ''
        })
      }
    }

    if (goalActive && stage === 'search' && mustSearch) {
      const q =
        String((goals as any).searchQuery || '').trim() ||
        (typeof parseQueryFromTask === 'function' ? String(parseQueryFromTask(String(state.task || '')) || '').trim() : '')
      const url = String(after || urlNow || '')
      const searchValue = String(afterSig.searchValue || '').trim()
      const enc = q ? encodeURIComponent(q) : ''
      const alreadyDetailWhileSearch = !!(afterHasVideo || visionHasPlayer || visionPageType === 'detail')
      if (alreadyDetailWhileSearch) {
        stage = mustEnterDetail ? 'enter_detail' : mustExtract ? 'extract' : 'done'
        emitLog('info', `目标阶段：检测到已进入详情页，跳过搜索校验，切换到 stage=${stage}`)
      } else {
      // 含百度 /s?wd=、通用 search|query|keyword，以及结果列表视觉态
      const onResults =
        visionPageType === 'list' ||
        /\/s(\?|$)/i.test(url) ||
        /[?&](wd|q|query|keyword|search)=/i.test(url) ||
        /search\./i.test(url) ||
        /\/search(\/|\?|$)/i.test(url)
      const queryOk =
        !q ||
        (searchValue && searchValue.includes(q)) ||
        (enc && url.includes(enc)) ||
        url.includes(q) ||
        String(afterSig.h1Text || '').includes(q) ||
        String(afterTitle || '').includes(q)
      const searchOk = onResults && queryOk
      if (searchOk) {
        stage = mustEnterDetail ? 'enter_detail' : mustExtract ? 'extract' : 'done'
        emitLog('info', `目标阶段：搜索已就绪，切换到 stage=${stage}`)
      } else {
        const error = '目标阶段：需要先完成搜索'
        emitLog('warn', error)
        if (!forcedExisting.length) {
          const onBiliGuest = isBilibiliGuestTask({ ...state, pageUrl: url })
          // 根因：未进结果页前不得捆绑 open_first_result（首页会误点频道）；搜索成功后再由 enter_detail 注入
          const searchStep = onBiliGuest
            ? bilibiliDirectSearchIntent(q || 'LangGraph', '目标阶段：B站直达搜索页')
            : baiduNeedsDirectSearch(url)
              ? baiduDirectSearchIntent(q || 'LangGraph', '目标阶段：百度直达搜索结果页')
              : ({ intent: 'search', args: { query: q || 'LangGraph' }, reason: '目标阶段：先执行搜索' } as any)
          const seqRaw = [searchStep] as any
          const seq = clipSeq(seqRaw as any)
          const bump = tryBumpForced('goal.search')
          if (!bump.ok) {
            return withFp({
              ...stopNeedHuman(`goal.search (${bump.error})`),
              stallCount: 0,
              stage: 'done',
              forcedIntents: [],
              forcedIntentsExpireAt: 0,
              forcedIntentsUsed: 0,
              forcedIntentsSource: '',
              route: 'end'
            })
          }
          return withFp({
            phase: 'verifying',
            error,
            stallCount,
            stage,
            forcedIntents: seq as any,
            forcedIntentsExpireAt: now + 45_000,
            ...forcedMetaBase,
            ...(bump.patch || {}),
            route: 'decision'
          })
        }
        if (isBilibiliGuestTask({ ...state, pageUrl: url }) && !/search\.bilibili\.com/i.test(url)) {
          const seq = clipSeq([bilibiliDirectSearchIntent(q || 'LangGraph', '目标阶段：强制改直达搜索页')] as any)
          if (seq.length) {
            emitLog('warn', '目标阶段：搜索 forced 未生效，升级为 B 站直达搜索页')
            return withFp({
              phase: 'verifying',
              error,
              stallCount,
              stage,
              forcedIntents: seq as any,
              forcedIntentsExpireAt: now + 45_000,
              ...forcedMetaBase,
              route: 'decision'
            })
          }
        }
        return withFp({ phase: 'verifying', error, stallCount, stage, failureType: 'no_effect', route: 'recover' })
      }
      }
    }

    if (action?.type === 'dismiss_overlays' && !progressStrong) {
      const error = visionHasOverlay ? '关闭弹窗/遮罩未生效：视觉仍判定存在遮罩' : '关闭弹窗/遮罩未生效'
      emitLog('warn', error)
      if (!forcedExisting.length) {
        const bilibiliGuest = isBilibiliGuestTask({ ...state, pageUrl: String(after || urlNow || state.pageUrl || '') })
        const goals = (state as any).goals || state.taskSpec?.goals || {}
        const mustSearch = !!(goals as any).mustSearch
        if (bilibiliGuest && mustSearch) {
          const q =
            String((goals as any).searchQuery || '').trim() ||
            (typeof parseQueryFromTask === 'function' ? String(parseQueryFromTask(String(state.task || '')) || '').trim() : '')
          const seq = clipSeq([
            { intent: 'goto', args: { url: bilibiliSearchUrl(q || 'LangGraph') }, reason: 'B站游客：跳过登录弹窗，直达搜索页' },
            { intent: 'open_first_result', reason: '进入第一个搜索结果' }
          ] as any)
          const bump = tryBumpForced('no_effect.dismiss_overlays.bilibili_search')
          if (!bump.ok) {
            return withFp(stopNeedHuman(`no_effect.dismiss_overlays (${bump.error})`))
          }
          return withFp({
            phase: 'verifying',
            error,
            stallCount,
            stage,
            failureType: 'no_effect',
            forcedIntents: seq as any,
            forcedIntentsExpireAt: now + 45_000,
            ...forcedMetaBase,
            ...(bump.patch || {}),
            route: 'decision'
          })
        }
        const seq = clipSeq(getForcedIntents('no_effect.dismiss_overlays', { allowRiskyRecoveryClicks: !!allowRiskyRecoveryClicks }))
        const bump = tryBumpForced('no_effect.dismiss_overlays')
        if (!bump.ok) {
          return withFp(stopNeedHuman(`no_effect.dismiss_overlays (${bump.error})`))
        }
        return withFp({
          phase: 'verifying',
          error,
          stallCount,
          stage,
          failureType: 'no_effect',
          forcedIntents: seq as any,
          forcedIntentsExpireAt: now + 30_000,
          ...forcedMetaBase,
          ...(bump.patch || {}),
          route: 'decision'
        })
      }
      return withFp({ phase: 'verifying', error, stallCount, stage, failureType: 'no_effect', route: 'recover' })
    }

    const h1LooksDetail = (() => {
      const s = afterH1
      if (!s || s.length < 3) return false
      if (/搜索|搜索结果|结果页|列表|首页|登录|注册|sign in|log in|privacy|cookie/i.test(s)) return false
      return true
    })()
    const isDetailSatisfied = !!(
      afterHasVideo ||
      visionHasPlayer ||
      visionPageType === 'detail' ||
      (h1LooksDetail && (h1Changed || linkCountChanged))
    )

    if (goalActive && stage === 'enter_detail' && mustEnterDetail) {
      if (isDetailSatisfied) {
        const wantsPlay = !forbidden.has('play') && (!allowed.size || allowed.has('play'))
        if (wantsPlay && state.waitForVideoEnd) {
          stage = 'watch'
          emitLog('info', `目标阶段：已进入详情页/视频页，切换到 stage=${stage}`)
          const seq = clipSeq([
            { intent: 'play', reason: '目标阶段：开始播放' },
            { intent: 'wait', args: { ms: 1000 }, reason: '目标阶段：等待播放至结束' }
          ] as any)
          const bump = tryBumpForced('goal.enter_detail.watch_until_end')
          if (!bump.ok) {
            return withFp(stopNeedHuman(`goal.enter_detail.watch_until_end (${bump.error})`))
          }
          return withFp({
            phase: 'verifying',
            stallCount: 0,
            stage,
            forcedIntents: seq as any,
            forcedIntentsExpireAt: now + 90_000,
            ...forcedMetaBase,
            ...(bump.patch || {}),
            route: 'decision',
            watchSeconds,
            watchUntilAt: 0,
            watchAnchorUrl: anchorNorm || currentAnchor
          })
        }
        if (wantsPlay && !state.waitForVideoEnd) {
          if (watchSeconds > 0) {
            stage = 'watch'
            const until = now + watchSeconds * 1000
            emitLog('info', `目标阶段：已进入详情页/视频页，切换到 stage=${stage}`)
            const seq = clipSeq([
              { intent: 'play', reason: '目标阶段：开始播放' },
              { intent: 'wait', args: { ms: Math.min(120000, Math.max(200, watchSeconds * 1000)) }, reason: `目标阶段：观看${watchSeconds}秒` }
            ] as any)
            const bump = tryBumpForced('goal.enter_detail.watch')
            if (!bump.ok) {
              return withFp(stopNeedHuman(`goal.enter_detail.watch (${bump.error})`))
            }
            return withFp({
              phase: 'verifying',
              stallCount: 0,
              stage,
              forcedIntents: seq as any,
              forcedIntentsExpireAt: Math.max(now + 45_000, until + 10_000),
              ...forcedMetaBase,
              ...(bump.patch || {}),
              route: 'decision',
              watchSeconds,
              watchUntilAt: until,
              watchAnchorUrl: anchorNorm || currentAnchor
            })
          }
          stage = 'play'
          emitLog('info', `目标阶段：已进入详情页/视频页，切换到 stage=${stage}`)
          const seq = clipSeq([{ intent: 'play', reason: '目标阶段：开始播放' }] as any)
          const bump = tryBumpForced('goal.enter_detail.play')
          if (!bump.ok) {
            return withFp(stopNeedHuman(`goal.enter_detail.play (${bump.error})`))
          }
          return withFp({
            phase: 'verifying',
            stallCount: 0,
            stage,
            forcedIntents: seq as any,
            forcedIntentsExpireAt: now + 30_000,
            ...forcedMetaBase,
            ...(bump.patch || {}),
            route: 'decision'
          })
        }
        const engageOnly = buildPendingEngagementSeq(state, forbidden, allowed, clipSeq)
        if (engageOnly.length) {
          stage = 'play'
          emitLog('info', '目标阶段：已进入详情页/视频页，切换到互动阶段')
          return withFp({
            phase: 'verifying',
            stallCount: 0,
            stage,
            forcedIntents: engageOnly as any,
            forcedIntentsExpireAt: now + 45_000,
            ...forcedMetaBase,
            route: 'decision'
          })
        }
        stage = mustExtract ? (mustReturnToListBeforeExtract ? 'return_list' : 'extract') : 'done'
        emitLog('info', `目标阶段：已进入详情页/视频页，切换到 stage=${stage}`)
      } else {
        const error = '目标阶段：需要先进入详情页/视频页'
        emitLog('warn', error)
        if (!forcedExisting.length) {
          const candArr = Array.isArray((state as any).candidates) ? ((state as any).candidates as any[]).map((x) => x || {}) : []
          const idx = pickGenericFirstResultCandidateIndex(candArr)
          const wantSearch = mustSearch
          const q = String((goals as any).searchQuery || '').trim() || '周杰伦'
          const seqRaw = getForcedIntents('no_effect.open_first_result', { entryIndex: idx, adapterKey, allowRiskyRecoveryClicks: !!allowRiskyRecoveryClicks })
          const seq = clipSeq(seqRaw as any)
          const bump = tryBumpForced('goal.enter_detail')
          if (!bump.ok) {
            return withFp(stopNeedHuman(`goal.enter_detail (${bump.error})`))
          }
          return withFp({
            phase: 'verifying',
            error,
            stallCount,
            stage,
            forcedIntents: seq as any,
            forcedIntentsExpireAt: now + 45_000,
            ...forcedMetaBase,
            ...(bump.patch || {}),
            route: 'decision'
          })
        }
        return withFp({ phase: 'verifying', error, stallCount, stage, failureType: 'no_effect', route: 'recover' })
      }
    }

    if (goalActive && stage === 'return_list' && mustReturnToListBeforeExtract) {
      const listUrl = String((state as any).listUrl || (state as any).plan?.startUrl || (state as any).startUrl || '').trim()
      const onList =
        visionPageType === 'list'
      if (onList || (listUrl && normalizeUrlForCompare(String(after || urlNow || '')) === normalizeUrlForCompare(listUrl))) {
        stage = 'extract'
      } else {
        const error = '目标阶段：需要返回列表/搜索结果页后再抽取'
        emitLog('warn', error)
        if (!forcedExisting.length) {
          const seq = clipSeq(
            listUrl && /^https?:\/\//i.test(listUrl)
              ? ([{ intent: 'goto', args: { url: listUrl }, reason: '目标阶段：返回列表页' }] as any)
              : ([{ intent: 'back', reason: '目标阶段：回退到列表页' }] as any)
          )
          const bump = tryBumpForced('goal.return_list')
          if (!bump.ok) {
            return withFp(stopNeedHuman(`goal.return_list (${bump.error})`))
          }
          return withFp({
            phase: 'verifying',
            error,
            stallCount,
            stage,
            forcedIntents: seq as any,
            forcedIntentsExpireAt: now + 30_000,
            ...forcedMetaBase,
            ...(bump.patch || {}),
            route: 'decision'
          })
        }
        return withFp({ phase: 'verifying', error, stallCount, stage, failureType: 'no_effect', route: 'recover' })
      }
    }

    if ((state as any).stopAfterExtract && action?.type === 'extract' && dataProgress) {
      emitLog('info', '强制结束：stopAfterExtract 已触发')
      return withFp({ phase: 'verifying', stallCount: 0, stopAfterExtract: false, stage, route: 'end' })
    }

    if (goalActive && stage === 'extract' && mustExtract) {
      const limit = extractLimit > 0 ? extractLimit : 1
      if (extractedNow >= limit) stage = 'done'
    }
    if (goalActive && stage === 'done') {
      // P3-L2：结束前消费 successCriteria / resultPageHints
      const taskSpecNow = (state as any).taskSpec && typeof (state as any).taskSpec === 'object' ? (state as any).taskSpec : {}
      const criteria = mergeSuccessCriteria(
        (taskSpecNow as any).successCriteria || parseSuccessCriteria((taskSpecNow as any)?.summary?.successCriteria),
        resultPageHintsFor(String(state.task || ''), String(after || urlNow || '')),
      )
      if (criteria.urlIncludes?.length || criteria.urlMatches || typeof criteria.extractMin === 'number') {
        const ev = evaluateSuccessCriteria({
          url: String(after || urlNow || ''),
          title: String(state.pageTitle || ''),
          extractCount: extractedNow,
          criteria,
        })
        if (!ev.ok && mustSearch && !/\/s\?|[?&]wd=|search\./i.test(String(after || urlNow || ''))) {
          emitLog('warn', `成功契约未满足：${ev.reason}，继续决策`)
          return withFp({
            phase: 'verifying',
            error: ev.reason,
            stallCount: Math.max(0, Math.floor(Number((state as any).stallCount || 0))) + 1,
            stage: 'search',
            route: 'decision',
          })
        }
      }
      emitLog('info', '目标阶段：已完成全部目标，结束任务')
      return withFp({ phase: 'verifying', stallCount: 0, stage, route: 'end' })
    }
    const playAttempts = Math.max(0, Math.floor(Number((state as any).playAttemptCount || 0)))
    const lastPlayError = String((state as any).lastPlayError || '').trim()
    if (intent === 'play' && (stage === 'play' || stage === 'watch')) {
      const afterOk = !!meta?.intentSatisfiedAfter
      if (!afterOk && playAttempts >= 3) {
        const msg = `播放失败：多次尝试仍未成功${lastPlayError ? `; lastError=${lastPlayError}` : ''}`
        emitLog('error', msg)
        return withFp({
          phase: 'verifying',
          error: msg,
          failureType: 'play_failed',
          stallCount: 0,
          stage: 'done',
          route: 'end',
          forcedIntents: [],
          forcedIntentsExpireAt: 0,
          forcedIntentsUsed: 0,
          forcedIntentsSource: '',
          playAttemptCount: 0
        })
      }
    }
    if (/^(play|like|coin|follow|favorite)$/.test(intent)) {
      const beforeOk = !!meta?.intentSatisfiedBefore
      const afterOk = !!meta?.intentSatisfiedAfter
      const toastAfter = String(meta?.toastAfter || '').trim()
      const toastIsStrong = /成功|已|完成|投币|点赞|已赞|已关注|已收藏|取消/i.test(toastAfter)
      const ok = afterOk || toastIsStrong
      if (ok) {
        const wantsLike = !forbidden.has('like') && (!allowed.size || allowed.has('like'))
        const wantsCoin = !forbidden.has('coin') && (!allowed.size || allowed.has('coin'))
        const wantsFollow = !forbidden.has('follow') && (!allowed.size || allowed.has('follow'))
        const wantsFavorite = !forbidden.has('favorite') && (!allowed.size || allowed.has('favorite'))
        const wantsSearch = mustSearch
        const wantsNext = !forbidden.has('paginate_next') && (!allowed.size || allowed.has('paginate_next'))
        const wantsExtract = mustExtract
        const wantsHistory = false
        const wantsPlay = !forbidden.has('play') && (!allowed.size || allowed.has('play'))
        const wantsTimedWatch = watchSeconds > 0
        const onlyLike =
          wantsLike &&
          !wantsCoin &&
          !wantsFollow &&
          !wantsFavorite &&
          !wantsSearch &&
          !wantsNext &&
          !wantsExtract &&
          !wantsHistory &&
          !wantsPlay
        const onlyCoin =
          wantsCoin &&
          !wantsLike &&
          !wantsFollow &&
          !wantsFavorite &&
          !wantsSearch &&
          !wantsNext &&
          !wantsExtract &&
          !wantsHistory &&
          !wantsPlay
        const onlyFollow =
          wantsFollow &&
          !wantsLike &&
          !wantsCoin &&
          !wantsFavorite &&
          !wantsSearch &&
          !wantsNext &&
          !wantsExtract &&
          !wantsHistory &&
          !wantsPlay
        const onlyFavorite =
          wantsFavorite &&
          !wantsLike &&
          !wantsCoin &&
          !wantsFollow &&
          !wantsSearch &&
          !wantsNext &&
          !wantsExtract &&
          !wantsHistory &&
          !wantsPlay
        const onlyPlay =
          wantsPlay &&
          !wantsLike &&
          !wantsCoin &&
          !wantsFollow &&
          !wantsFavorite &&
          !wantsSearch &&
          !wantsNext &&
          !wantsExtract &&
          !wantsHistory &&
          !state.waitForVideoEnd &&
          !wantsTimedWatch
        const shouldEndByStage = intent === 'play' && stage === 'play' && !state.waitForVideoEnd
        const shouldEnd =
          (intent === 'like' && (onlyLike || afterOk || toastIsStrong)) ||
          (intent === 'coin' && (onlyCoin || afterOk || toastIsStrong)) ||
          (intent === 'follow' && (onlyFollow || afterOk || toastIsStrong)) ||
          (intent === 'favorite' && (onlyFavorite || afterOk || toastIsStrong)) ||
          (intent === 'play' && ((onlyPlay && (afterOk || !beforeOk)) || shouldEndByStage))
        emitLog(
          'info',
          `结果验证：intent=${intent} 判定为成功${toastAfter ? `; toast=${toastAfter}` : ''}${shouldEnd ? '; end=true' : ''}`
        )
        return withFp({ phase: 'verifying', stallCount: 0, stage, route: shouldEnd ? 'end' : 'perception' })
      }
    }
    if (intent === 'open_first_result') {
      const videoBecameVisible = afterHasVideo && !beforeHasVideo
      const linkCountDropped = Number.isFinite(beforeLinkCount) && beforeLinkCount >= 12 && afterLinkCount > 0 && afterLinkCount <= beforeLinkCount * 0.6
      const okBySignals = videoBecameVisible || (h1Changed && h1LooksDetail) || (h1LooksDetail && linkCountDropped)

      const ok = !!(urlChanged || titleChanged || textChanged || okBySignals)
      if (ok) {
        emitLog('info', `结果验证：intent=open_first_result 判定为成功; urlChanged=${urlChanged}`)
        return withFp({ phase: 'verifying', stallCount: 0, stage, route: 'perception' })
      }
      const error = '结果验证：未进入详情页/视频页（open_first_result 未达成）'
      emitLog('warn', error)
      if (!forcedExisting.length) {
        const seqRaw = (() => {
              const candArr = Array.isArray((state as any).candidates) ? ((state as any).candidates as any[]).map((x) => x || {}) : []
              const idx = pickGenericFirstResultCandidateIndex(candArr)
              return getForcedIntents('no_effect.open_first_result', { entryIndex: idx, adapterKey, allowRiskyRecoveryClicks: !!allowRiskyRecoveryClicks })
            })()
        const seq = clipSeq(seqRaw as any)
        const bump = tryBumpForced('no_effect.open_first_result')
        if (!bump.ok) {
          return withFp(stopNeedHuman(`no_effect.open_first_result (${bump.error})`))
        }
        return withFp({
          phase: 'verifying',
          error,
          stallCount,
          stage,
          failureType: 'no_effect',
          forcedIntents: seq as any,
          forcedIntentsExpireAt: now + 45_000,
          ...forcedMetaBase,
          ...(bump.patch || {}),
          route: 'decision'
        })
      }
      return withFp({ phase: 'verifying', error, stallCount, stage, failureType: 'no_effect', route: 'recover' })
    }
    if (intent === 'search') {
      const q = String((goals as any).searchQuery || '').trim() || ''
      const qNorm = q.toLowerCase()
      const ok = /search|搜索/i.test(after) || /search|搜索/i.test(afterTitle) || /search|搜索/i.test(String(state.pageTitle || ''))
      const okByQuery =
        !!qNorm &&
        (String(afterTitle || '').toLowerCase().includes(qNorm) ||
          String(state.pageTitle || '').toLowerCase().includes(qNorm) ||
          String(state.pageText || '').toLowerCase().includes(qNorm) ||
          String(afterSig.searchValue || '').toLowerCase().includes(qNorm))
      const beforeLinkCount = Number(meta?.linkCountBefore ?? 0)
      const afterLinkCount = Number(afterSig.linkCount || 0)
      const linksIncreased = Number.isFinite(beforeLinkCount) && afterLinkCount >= Math.max(8, beforeLinkCount + 6)
      const okByLinks = afterLinkCount >= 8 && ((changed || okByQuery) || linksIncreased)
      if (ok || changed || okByQuery || okByLinks) return withFp({ phase: 'verifying', stallCount: 0, stage, route: 'perception' })
      const error = '结果验证：搜索入口可能未生效（search 未达成）'
      emitLog('warn', error)
      if (!forcedExisting.length) {
        const seq = clipSeq(getForcedIntents('no_effect.search', { query: q || 'LangGraph', allowRiskyRecoveryClicks: !!allowRiskyRecoveryClicks }))
        const bump = tryBumpForced('no_effect.search')
        if (!bump.ok) {
          return withFp(stopNeedHuman(`no_effect.search (${bump.error})`))
        }
        return withFp({
          phase: 'verifying',
          error,
          stallCount,
          stage,
          failureType: 'no_effect',
          forcedIntents: seq as any,
          forcedIntentsExpireAt: now + 45_000,
          ...forcedMetaBase,
          ...(bump.patch || {}),
          route: 'decision'
        })
      }
      return withFp({ phase: 'verifying', error, stallCount, stage, failureType: 'no_effect', route: 'recover' })
    }
    if (intent === 'paginate_next') {
      const y0 = Number(meta?.scrollYBefore ?? 0)
      const y1 = Number(afterSig.scrollY ?? 0)
      const dy = Number.isFinite(y0) && Number.isFinite(y1) ? Math.abs(y1 - y0) : 0
      const href0 = String(meta?.firstLinkHrefBefore || '').trim()
      const href1 = String(afterSig.firstLinkHref || '').trim()
      const okBySignals = (href0 && href1 && href0 !== href1) || dy >= 260
      if (changed || okBySignals) return withFp({ phase: 'verifying', stallCount: 0, stage, route: 'perception' })
      const error = '结果验证：翻页可能未生效（paginate_next 未达成）'
      emitLog('warn', error)
      if (!forcedExisting.length) {
        const candArr = Array.isArray((state as any).candidates) ? ((state as any).candidates as any[]).map((x) => x || {}) : []
        const nextIdx = pickCandidateIndexByIntent(candArr, 'next')
        const seq = clipSeq(getForcedIntents('no_effect.paginate_next', { nextIndex: nextIdx, allowRiskyRecoveryClicks: !!allowRiskyRecoveryClicks }))
        const bump = tryBumpForced('no_effect.paginate_next')
        if (!bump.ok) {
          return withFp(stopNeedHuman(`no_effect.paginate_next (${bump.error})`))
        }
        return withFp({
          phase: 'verifying',
          error,
          stallCount,
          stage,
          failureType: 'no_effect',
          forcedIntents: seq as any,
          forcedIntentsExpireAt: now + 45_000,
          ...forcedMetaBase,
          ...(bump.patch || {}),
          route: 'decision'
        })
      }
      return withFp({ phase: 'verifying', error, stallCount, stage, failureType: 'no_effect', route: 'recover' })
    }
    if (intent && !changed) {
      const beforeOk = !!meta?.intentSatisfiedBefore
      const afterOk = !!meta?.intentSatisfiedAfter
      const toastAfter = String(meta?.toastAfter || '').trim()
      const toastIsStrong = /成功|已|完成|投币|点赞|已赞|已关注|已收藏|取消/i.test(toastAfter)
      const allowToastIntent = /^(like|coin|follow|favorite|close|login)$/.test(intent)
      if ((afterOk && !beforeOk) || (allowToastIntent && toastAfter && toastIsStrong)) {
        emitLog('info', `结果验证：intent=${intent} 判定为成功${toastAfter ? `; toast=${toastAfter}` : ''}`)
        return withFp({ phase: 'verifying', stallCount: 0, stage, route: 'perception' })
      }
    }

    const loginSignalText = `${String(afterTitle || '')}\n${String(afterSig.h1Text || '')}\n${String((state as any).pageText || '')}`.slice(0, 1600)
    const loginLikelyByText =
      /请先登录|登录后|扫码登录|登录即可|立即登录|去登录|账号登录|sign in|log in|passport/i.test(loginSignalText) &&
      /登录|sign in|log in|passport/i.test(loginSignalText)
    if (looksLikeLoginUrl(after) || /登录|注册|sign in|log in|passport/i.test(afterTitle) || loginLikelyByText) {
      const error = '疑似需要登录'
      emitLog('warn', error)
      return withFp({ phase: 'verifying', error, stallCount, stage, failureType: 'need_login', route: 'recover' })
    }
    if (/captcha|recaptcha|turnstile|cloudflare|人机|验证|安全校验/i.test(afterTitle)) {
      const error = '疑似触发人机校验/反爬'
      emitLog('warn', error)
      return withFp({ phase: 'verifying', error, stallCount, stage, failureType: 'captcha', route: 'recover' })
    }

    if (!changed && action?.type === 'goto') {
      const error = '动作可能未生效：goto 后页面未发生变化'
      emitLog('warn', error)
      const forcedExisting = Array.isArray((state as any).forcedIntents) ? ((state as any).forcedIntents as any[]).filter(Boolean) : []
      if (!forcedExisting.length) {
        const seq = clipSeq(getForcedIntents('no_effect.goto'))
        const bump = tryBumpForced('no_effect.goto')
        if (!bump.ok) {
          return withFp(stopNeedHuman(`no_effect.goto (${bump.error})`))
        }
        return withFp({
          phase: 'verifying',
          error,
          stallCount,
          stage,
          failureType: 'no_effect',
          forcedIntents: seq as any,
          forcedIntentsExpireAt: now + 30_000,
          ...forcedMetaBase,
          ...(bump.patch || {}),
          route: 'decision'
        })
      }
      return withFp({ phase: 'verifying', error, stallCount, stage, failureType: 'no_effect', route: 'recover' })
    }

    if (!changed && action?.type === 'click_candidate') {
      
      const idx = Number((action as any).index)
      const cand = Array.isArray(state.candidates) ? (state.candidates as any[])[Math.max(0, Math.floor(idx))] : null
      const kind = String(cand?.kind || '').toLowerCase()
      const label = String(cand?.label || '')
      const navigationIntent = kind === 'link' || /下一页|下页|next|更多|more|详情|detail|进入|打开/i.test(label)
      if (navigationIntent && Number(state.sameUrlCount || 0) >= 1) {
        const error = '动作可能未生效：点击后页面未发生变化'
        emitLog('warn', error)
        const forcedExisting = Array.isArray((state as any).forcedIntents) ? ((state as any).forcedIntents as any[]).filter(Boolean) : []
        if (!forcedExisting.length) {
          const seq = clipSeq(getForcedIntents('no_effect.click_candidate_nav', { index: Math.max(0, Math.floor(idx)), allowRiskyRecoveryClicks: !!allowRiskyRecoveryClicks }))
          const bump = tryBumpForced('no_effect.click_candidate_nav')
          if (!bump.ok) {
            return withFp(stopNeedHuman(`no_effect.click_candidate_nav (${bump.error})`))
          }
          return withFp({
            phase: 'verifying',
            error,
            stallCount,
            stage,
            failureType: 'no_effect',
            forcedIntents: seq as any,
            forcedIntentsExpireAt: now + 30_000,
            ...forcedMetaBase,
            ...(bump.patch || {}),
            route: 'decision'
          })
        }
        return withFp({ phase: 'verifying', error, stallCount, stage, failureType: 'no_effect', route: 'recover' })
      }
    }

    if (!changed && (action?.type === 'type' || action?.type === 'type_candidate')) {
      const rawText = String((action as any).text || '')
      const wantsEnter = /\n$/.test(rawText) || /\{enter\}$/i.test(rawText.trim())
      if (wantsEnter && Number(state.sameUrlCount || 0) >= 1) {
        const error = '动作可能未生效：输入并提交后页面未发生变化'
        emitLog('warn', error)
        const forcedExisting = Array.isArray((state as any).forcedIntents) ? ((state as any).forcedIntents as any[]).filter(Boolean) : []
        if (!forcedExisting.length) {
          const q = String((goals as any).searchQuery || '').trim() || 'LangGraph'
          const seq = clipSeq(getForcedIntents('no_effect.type_submit', { query: q, allowRiskyRecoveryClicks: !!allowRiskyRecoveryClicks }))
          const bump = tryBumpForced('no_effect.type_submit')
          if (!bump.ok) {
            return withFp(stopNeedHuman(`no_effect.type_submit (${bump.error})`))
          }
          return withFp({
            phase: 'verifying',
            error,
            stallCount,
            stage,
            failureType: 'no_effect',
            forcedIntents: seq as any,
            forcedIntentsExpireAt: now + 30_000,
            ...forcedMetaBase,
            ...(bump.patch || {}),
            route: 'decision'
          })
        }
        return withFp({ phase: 'verifying', error, stallCount, stage, failureType: 'no_effect', route: 'recover' })
      }
    }

    emitLog('info', '结果验证：继续下一轮感知')
    return withFp({ phase: 'verifying', stallCount, stage, route: 'perception' })
  }

  return nodeVerify
}
