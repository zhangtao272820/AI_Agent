type ExecuteDismissOverlaysContext = {
  state: any
  session: any
  params: any
  stepCount: number
  pageUrlBefore: string
  extractedCountBefore: number
  tryDismissOverlays: (page: any) => Promise<any>
  pageSnapshot: (page: any) => Promise<any>
  pushState: (nextState: any) => void
  buildEndMeta: (meta: any) => Promise<any>
  textDigest: (text: string) => string
  emitStepEnd: (meta: any) => void
}

export async function executeDismissOverlays(ctx: ExecuteDismissOverlaysContext) {
  const { state, session, params, stepCount, pageUrlBefore, extractedCountBefore, tryDismissOverlays, pageSnapshot, pushState, buildEndMeta, textDigest, emitStepEnd } = ctx
  await tryDismissOverlays(session!.page).catch(() => {})
  await session!.page.waitForTimeout(220).catch(() => {})
  const snap = await pageSnapshot(session!.page)
  params.emit({ type: 'screenshot', payload: { dataUrl: snap.dataUrl, ts: Date.now() } })
  pushState({ ...state, phase: 'acting', stepCount, pageUrl: snap.url })
  const endMeta = await buildEndMeta({
    ok: true,
    type: 'dismiss_overlays',
    pageUrlBefore,
    pageUrlAfter: snap.url,
    pageTitleAfter: snap.title,
    pageTextHashAfter: textDigest(snap.text),
    pageTextLenAfter: snap.text.length
  })
  emitStepEnd(endMeta)
  return { stepCount, phase: 'acting', pageUrl: snap.url, pageTitle: snap.title, pageText: snap.text, screenshotDataUrl: snap.dataUrl, route: 'verify', lastStepMeta: endMeta, failureType: '', extractedCountBefore }
}
