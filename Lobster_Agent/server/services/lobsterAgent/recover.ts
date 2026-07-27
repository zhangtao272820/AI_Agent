import type { GraphNode } from '@langchain/langgraph'
export function createNodeRecover(deps: any): GraphNode<any> {
  const {
    ensureNotAborted,
    waitWhilePaused,
    headless,
    session,
    emitLog,
    allowRiskyRecoveryClicks,
    tryDismissOverlays,
    pickCandidateIndexByIntent,
    pickGenericFirstResultCandidateIndex,
    getForcedIntents,
    maxRecoverCount,
    maxForcedIntentsTotal,
    maxForcedIntentsPerFailure
  } = deps

  const stopNeedHuman = (reason: string) => {
    const msg = `需要人工介入：${String(reason || '恢复预算已用尽')}。已停止自动尝试，避免误操作。`
    emitLog('error', msg)
    return { phase: 'error', route: 'end', failureType: 'need_human', error: msg }
  }

  const nodeRecover: GraphNode<any> = async (state) => {
    ensureNotAborted()
    await waitWhilePaused()
    const retry = Number(state.retry || 0) + 1
    const recoverCount = Math.max(0, Math.floor(Number((state as any).recoverCount || 0))) + 1
    const recoverLimit = Math.max(0, Math.floor(Number(maxRecoverCount ?? 6)))
    const err = String(state.error || 'unknown error')
    const failureType = String((state as any).failureType || '')
    const prevFailures = Array.isArray((state as any).recentFailures)
      ? ((state as any).recentFailures as any[]).map((x) => String(x || '').trim()).filter(Boolean)
      : []
    const failureHint = `${failureType || 'unknown'}:${err}`.slice(0, 180)
    const recentFailures = [...prevFailures, failureHint].slice(-3)
    const failurePatch = { recentFailures }
    emitLog('warn', `异常处理：${err}`)
    if (recoverLimit > 0 && recoverCount > recoverLimit) {
      return { ...stopNeedHuman(`recoverCount=${recoverCount}/${recoverLimit}`), retry, recoverCount, ...failurePatch }
    }
    if (retry >= 3) {
      emitLog('error', '重试次数过多，结束任务')
      return { phase: 'error', retry, route: 'end', recoverCount, ...failurePatch }
    }
    if (failureType === 'captcha') {
      if (!headless) {
        emitLog('warn', '异常处理：疑似人机校验/反爬，进入验证码等待流程')
        return { phase: 'error', retry, route: 'captcha', failureType, recoverCount, ...failurePatch }
      }
      emitLog('error', '异常处理：疑似人机校验/反爬（headless 无法处理），结束任务')
      return { phase: 'error', retry, route: 'end', failureType, recoverCount, ...failurePatch }
    }
    if (failureType === 'rate_limited') {
      emitLog('error', '异常处理：疑似触发限流，结束任务')
      return { phase: 'error', retry, route: 'end', failureType, recoverCount, ...failurePatch }
    }
    if (failureType === 'need_login' && !headless) {
      emitLog('info', '异常处理：疑似需要登录，进入登录流程')
      return { phase: 'error', retry, route: 'login', failureType, recoverCount, ...failurePatch }
    }
    if (failureType === 'denied') {
      emitLog('warn', '异常处理：用户拒绝危险操作，结束任务')
      return { phase: 'error', retry, route: 'end', failureType, recoverCount, ...failurePatch }
    }
    if (/^crawler_/.test(failureType)) {
      emitLog('error', `异常处理：${failureType}，结束任务`)
      return { phase: 'error', retry, route: 'end', failureType, recoverCount, ...failurePatch }
    }

    const action = state.action as any
    const resolveCandidate = (index: number) => {
      const arr = Array.isArray(state.candidates) ? (state.candidates as any[]).map((x) => x || {}) : []
      const idx = Number(index)
      if (!Number.isFinite(idx)) return null
      const c = arr[Math.max(0, Math.floor(idx))]
      return c || null
    }
    const tryClickByBbox = async (bbox: any) => {
      const b = bbox && typeof bbox === 'object' ? bbox : null
      if (!b) return false
      const x = Number(b.x)
      const y = Number(b.y)
      const w = Number(b.width)
      const h = Number(b.height)
      if (![x, y, w, h].every((n) => Number.isFinite(n))) return false
      const vp = session.page.viewportSize?.() as any
      const maxX = Number(vp?.width || 1280) - 2
      const maxY = Number(vp?.height || 720) - 2
      const cx = Math.max(2, Math.min(maxX, Math.floor(x + Math.max(0, w) / 2)))
      const cy = Math.max(2, Math.min(maxY, Math.floor(y + Math.max(0, h) / 2)))
      await session.page.mouse.move(cx, cy).catch(() => {})
      await session.page.mouse.click(cx, cy).catch(() => {})
      return true
    }

    await tryDismissOverlays(session.page).catch(() => {})
    await session.page.waitForTimeout(200).catch(() => {})
    if (failureType === 'network') {
      await session.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
      await session.page.waitForTimeout(200).catch(() => {})
    }
    if ((failureType === 'blocked_by_overlay' || failureType === 'timeout') && action?.type === 'click_candidate') {
      const idx = Number((action as any).index)
      const cand: any = resolveCandidate(idx)
      if (cand?.bbox && /关闭|取消|dismiss|close/i.test(String(cand?.label || ''))) {
        emitLog('info', '异常处理：尝试使用坐标点击候选框')
        const ok = await tryClickByBbox(cand.bbox).catch(() => false)
        if (ok) await session.page.waitForTimeout(350).catch(() => {})
      }
    }
    if ((failureType === 'not_visible' || failureType === 'selector_not_found' || failureType === 'detached') && !headless) {
      await session.page.mouse.wheel(0, 700).catch(() => {})
      await session.page.waitForTimeout(180).catch(() => {})
    }
    const meta: any = (state as any).lastStepMeta
    const intent = String(meta?.intent || '')
    const urlNow = String(state.pageUrl || '')
    
    const forcedExisting = Array.isArray((state as any).forcedIntents) ? ((state as any).forcedIntents as any[]).filter(Boolean) : []
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
    const forcedCountsRaw =
      (state as any).forcedInjectCounts && typeof (state as any).forcedInjectCounts === 'object' ? { ...(state as any).forcedInjectCounts } : {}
    const forcedTotalRaw = Math.max(0, Math.floor(Number((state as any).forcedInjectTotal || 0)))
    const maxTotal = Math.max(0, Math.floor(Number(maxForcedIntentsTotal ?? 10)))
    const maxPerFailure = Math.max(0, Math.floor(Number(maxForcedIntentsPerFailure ?? 2)))
    const tryBumpForced = (key: string) => {
      const k = String(key || 'recover')
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
    const force = (seq: any[]) => {
      if (forcedExisting.length) return undefined
      if (!seq.length) return undefined
      return seq as any
    }
    const goalsRaw = (state as any).goals
    const goals = goalsRaw && typeof goalsRaw === 'object' ? goalsRaw : {}
    const q = String((goals as any).searchQuery || '').trim() || 'LangGraph'
    const adapterKey = ''
    const vj = (state as any).visionJson
    const visionPageType = vj && typeof vj === 'object' ? String((vj as any).pageType || '').trim().toLowerCase() : ''
    const visionHasOverlay = vj && typeof vj === 'object' ? !!(vj as any).hasOverlay : false
    const stageFromState = String((state as any).stage || '').trim().toLowerCase()
    const stageFromVision = visionPageType || 'unknown'
    const visionPrimaryCtas =
      vj && typeof vj === 'object' && Array.isArray((vj as any).primaryCtas)
        ? ((vj as any).primaryCtas as any[]).map(String).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 6)
        : []
    if (visionPageType === 'captcha') {
      if (!headless) {
        emitLog('warn', '异常处理：视觉判定为 captcha 页面，等待用户处理后继续')
        return { phase: 'error', retry, route: 'captcha', failureType: 'captcha', recoverCount }
      }
      emitLog('error', '异常处理：视觉判定为 captcha 页面（headless 无法处理），结束任务')
      return { phase: 'error', retry, route: 'end', failureType: 'captcha', recoverCount }
    }
    if (visionPageType === 'login' && !headless) {
      emitLog('info', '异常处理：视觉判定为登录页，进入登录流程')
      return { phase: 'error', retry, route: 'login', failureType: 'need_login', recoverCount }
    }
    const closeIndex = pickCandidateIndexByIntent(Array.isArray(state.candidates) ? (state.candidates as any[]) : [], 'close')
    const entryIndex = pickGenericFirstResultCandidateIndex(Array.isArray(state.candidates) ? (state.candidates as any[]) : [])
    const mustSearch = !!(goals as any).mustSearch
    const mustEnterDetail = !!(goals as any).mustEnterDetail
    const mustExtract = !!(goals as any).mustExtract
    const extractLimitRaw = Number((goals as any).extractLimit || 0)
    const extractLimit = Number.isFinite(extractLimitRaw) && extractLimitRaw > 0 ? Math.floor(extractLimitRaw) : 0
    const stageFromGoals =
      mustSearch ? 'search' : mustEnterDetail ? 'enter_detail' : mustExtract ? 'extract' : ''
    const fromStateOrVision =
      stageFromState && stageFromState !== 'unknown' ? stageFromState : stageFromVision
    const stage =
      fromStateOrVision && fromStateOrVision !== 'unknown'
        ? fromStateOrVision
        : stageFromGoals || fromStateOrVision
    const wantSearch = mustSearch
    const stageAllowsRecovery = (from: string, to: string) => {
      const f = String(from || '').trim().toLowerCase()
      const t = String(to || '').trim().toLowerCase()
      if (!f || !t || f === 'unknown' || f === t) return true
      const allowed: Record<string, string[]> = {
        captcha: ['login', 'home', 'search', 'list', 'detail', 'play', 'history', 'unknown'],
        login: ['home', 'search', 'list', 'detail', 'play', 'history', 'unknown'],
        home: ['search', 'list', 'detail', 'play', 'history', 'unknown'],
        search: ['list', 'detail', 'play', 'history', 'unknown'],
        list: ['detail', 'play', 'history', 'unknown'],
        detail: ['play', 'list', 'history', 'unknown'],
        play: ['detail', 'list', 'history', 'unknown'],
        history: ['detail', 'play', 'list', 'unknown'],
        unknown: ['home', 'search', 'list', 'detail', 'play', 'history', 'login', 'captcha']
      }
      return (allowed[f] || []).includes(t)
    }
    const recoveryStageHint = stageFromVision || 'unknown'
    const stageTransitionPatch =
      {}
    const visionDrivenForced = (() => {
      if (forcedExisting.length) return undefined
      if (visionHasOverlay) {
        return force(getForcedIntents('recover.blocked_by_overlay', { closeIndex, allowRiskyRecoveryClicks: !!allowRiskyRecoveryClicks }))
      }
      if (!stageAllowsRecovery(stage, recoveryStageHint)) {
        if (recoveryStageHint === 'play' || recoveryStageHint === 'detail') {
          return force([{ intent: 'dismiss_overlays', reason: '阶段恢复：先稳定在播放/详情态' }, { intent: 'ensure_play', reason: '阶段恢复：确保视频继续播放' }])
        }
        if (recoveryStageHint === 'search' && mustSearch) {
          return force([{ intent: 'search', args: { query: q || 'LangGraph' }, reason: '阶段恢复：回到搜索态' }])
        }
        if (recoveryStageHint === 'list' && mustEnterDetail) {
          return force([{ intent: 'open_first_result', reason: '阶段恢复：回到列表并进入结果' }])
        }
      }
      if (stage === 'search' && mustSearch && wantSearch) {
        return force([{ intent: 'search', args: { query: q || 'LangGraph' }, reason: '异常恢复：重新执行搜索' }] as any)
      }
      
      if ((stage === 'play' || stage === 'watch') && visionPageType === 'detail') {
        return force([
          { intent: 'dismiss_overlays', reason: '视觉恢复：播放阶段先清理遮罩' },
          { intent: 'ensure_play', reason: '视觉恢复：确保视频继续播放' }
        ])
      }
      if (stage === 'extract' && mustExtract) {
        return force([{ intent: 'extract_items', args: { ...(extractLimit > 0 ? { limit: extractLimit } : {}) }, reason: '视觉恢复：继续抽取' }])
      }
      if (visionPageType === 'list' && mustEnterDetail) {
        return force([
          { intent: 'dismiss_overlays', reason: '视觉恢复：先关闭遮罩/弹窗' },
          { intent: 'open_first_result', reason: '视觉恢复：进入第一个结果' }
        ])
      }
      return undefined
    })()
    const forcedIntents =
      visionDrivenForced ||
      (failureType === 'blocked_by_overlay'
        ? force(getForcedIntents('recover.blocked_by_overlay', { closeIndex, allowRiskyRecoveryClicks: !!allowRiskyRecoveryClicks }))
        : failureType === 'no_effect'
          ? force(
              intent === 'open_first_result'
                ? getForcedIntents('recover.no_effect.open_first_result', { entryIndex, adapterKey, allowRiskyRecoveryClicks: !!allowRiskyRecoveryClicks })
                : intent === 'search'
                  ? getForcedIntents('recover.no_effect.search', { query: q, allowRiskyRecoveryClicks: !!allowRiskyRecoveryClicks })
                  : intent === 'play'
                    ? getForcedIntents('recover.no_effect.play_from_search', { allowRiskyRecoveryClicks: !!allowRiskyRecoveryClicks })
                    : intent === 'paginate_next'
                      ? getForcedIntents('recover.no_effect.paginate_next', { nextIndex: entryIndex, allowRiskyRecoveryClicks: !!allowRiskyRecoveryClicks })
                      : getForcedIntents('recover.no_effect.generic', { allowRiskyRecoveryClicks: !!allowRiskyRecoveryClicks } as any)
            )
          : failureType === 'timeout'
            ? force(getForcedIntents('recover.timeout', { allowRiskyRecoveryClicks: !!allowRiskyRecoveryClicks } as any))
            : failureType === 'selector_not_found'
              ? force(getForcedIntents('recover.selector_not_found', { allowRiskyRecoveryClicks: !!allowRiskyRecoveryClicks } as any))
              : failureType === 'detached'
                ? force(getForcedIntents('recover.detached', { allowRiskyRecoveryClicks: !!allowRiskyRecoveryClicks } as any))
                : failureType === 'not_visible'
                  ? force(getForcedIntents('recover.not_visible', { allowRiskyRecoveryClicks: !!allowRiskyRecoveryClicks } as any))
                  : undefined)

    return {
      phase: 'error',
      retry,
      route: 'perception',
      failureType: '',
      recoverCount,
      ...failurePatch,
      ...stageTransitionPatch,
      ...(forcedIntents && Array.isArray(forcedIntents) && forcedIntents.length
        ? (() => {
            const seq = clipSeq(forcedIntents)
            if (!seq.length) return {}
            const bump = tryBumpForced(`recover.${failureType || 'generic'}`)
            if (!bump.ok) {
              return stopNeedHuman(`recover.${failureType || 'generic'} (${bump.error})`)
            }
            return {
              forcedIntents: seq,
              forcedIntentsExpireAt: Date.now() + 45_000,
              forcedIntentsUsed: 0,
              forcedIntentsSource: 'recover',
              ...(bump.patch || {})
            }
          })()
        : {})
    }
  }

  return nodeRecover
}
