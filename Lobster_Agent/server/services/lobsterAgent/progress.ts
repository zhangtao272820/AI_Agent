type AnyObj = Record<string, any>

export type Progress = {
  score: number
  reasons: string[]
}

export function computeProgress(params: {
  meta: AnyObj
  normalizeUrlForCompare?: (url: string) => string
  extractedDelta?: number
}): Progress {
  const meta = params.meta && typeof params.meta === 'object' ? params.meta : {}
  const normalize = typeof params.normalizeUrlForCompare === 'function' ? params.normalizeUrlForCompare : (u: string) => String(u || '')
  const reasons: string[] = []
  let score = 0

  const u0 = normalize(String(meta.pageUrlBefore || ''))
  const u1 = normalize(String(meta.pageUrlAfter || ''))
  const urlChanged = !!u0 && !!u1 && u0 !== u1
  if (urlChanged) {
    score += 0.55
    reasons.push('url_changed')
  }

  const video = meta.video && typeof meta.video === 'object' ? meta.video : null
  const advanced = video ? !!(video as any).advanced : false
  const endedEarly = video ? !!(video as any).ended : false

  const titleChanged = String(meta.pageTitleBefore || '') && String(meta.pageTitleAfter || '') && String(meta.pageTitleBefore) !== String(meta.pageTitleAfter)
  const textChanged =
    String(meta.pageTextHashBefore || '') &&
    String(meta.pageTextHashAfter || '') &&
    String(meta.pageTextHashBefore) !== String(meta.pageTextHashAfter)
  const h1Changed = String(meta.h1TextBefore || '') && String(meta.h1TextAfter || '') && String(meta.h1TextBefore) !== String(meta.h1TextAfter)
  const linkCountBefore = Number(meta.linkCountBefore ?? NaN)
  const linkCountAfter = Number(meta.linkCountAfter ?? NaN)
  const linkCountChanged =
    Number.isFinite(linkCountBefore) &&
    Number.isFinite(linkCountAfter) &&
    ((linkCountBefore >= 8 && Math.abs(linkCountAfter - linkCountBefore) >= 6) || (linkCountBefore >= 12 && linkCountAfter > 0 && linkCountAfter <= linkCountBefore * 0.6))
  const firstLinkChanged = String(meta.firstLinkHrefBefore || '') && String(meta.firstLinkHrefAfter || '') && String(meta.firstLinkHrefBefore) !== String(meta.firstLinkHrefAfter)
  const searchChanged = String(meta.searchValueBefore || '') && String(meta.searchValueAfter || '') && String(meta.searchValueBefore) !== String(meta.searchValueAfter)
  const structuralChanged = titleChanged || h1Changed || linkCountChanged || firstLinkChanged || searchChanged
  const onlyLiveFeedTextChurn = textChanged && !structuralChanged
  const playIntentOk = !!(meta as any).intentSatisfiedAfter
  const playStep = String(meta.type || '') === 'ensure_play'
  const suppressSemanticNoise =
    onlyLiveFeedTextChurn && (advanced || endedEarly || (playStep && playIntentOk))
  const semanticChanged = titleChanged || textChanged || h1Changed || linkCountChanged || firstLinkChanged || searchChanged
  if (semanticChanged && !suppressSemanticNoise) {
    score += 0.25
    reasons.push('semantic_changed')
  }

  const extractedDelta = Math.max(0, Math.floor(Number(params.extractedDelta ?? meta.extractedDelta ?? 0)))
  if (extractedDelta > 0) {
    score += 0.75
    reasons.push('data_progress')
  }

  if (advanced) {
    score += 0.65
    reasons.push('video_advanced')
  }
  const ended = endedEarly
  if (ended) {
    score += 0.35
    reasons.push('video_ended')
  }

  if (score > 1) score = 1
  if (score < 0) score = 0
  return { score: Math.round(score * 100) / 100, reasons }
}

