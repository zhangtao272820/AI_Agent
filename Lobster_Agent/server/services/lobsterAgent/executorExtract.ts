type ExecuteExtractContext = {
  action: any
  state: any
  session: any
  stepCount: number
  pageUrlBefore: string
  extractedCountBefore: number
  parseTopNFromTask: (task: string) => number
  extractGenericListItems: (page: any, limit: number) => Promise<any[]>
  extractStructured: (fields: any, pageText: string) => Promise<any>
  buildEndMeta: (meta: any) => Promise<any>
  textDigest: (text: string) => string
  emitStepEnd: (meta: any) => void
}

export async function executeExtract(ctx: ExecuteExtractContext) {
  const {
    action,
    state,
    session,
    stepCount,
    pageUrlBefore,
    extractedCountBefore,
    parseTopNFromTask,
    extractGenericListItems,
    extractStructured,
    buildEndMeta,
    textDigest,
    emitStepEnd
  } = ctx

  const urlNow = String(state.pageUrl || '')
  try {
    await session!.page.waitForLoadState('domcontentloaded', { timeout: 2000 })
  } catch {}
  try {
    await session!.page.waitForLoadState('networkidle', { timeout: 1500 })
  } catch {}
  await session!.page.waitForTimeout(400)
  const limitFromAction = Number((action as any).limit || 0)
  const limitFromTask = parseTopNFromTask(state.task)
  const itemLimit = Number.isFinite(limitFromAction) && limitFromAction > 0 ? Math.min(20, Math.floor(limitFromAction)) : limitFromTask || 0

  const wantItems =
    (Array.isArray((action as any).fields) && (action as any).fields.map(String).includes('items')) ||
    /前\s*\d+\s*条|top\s*\d+|列表|结果|items/i.test(String(state.task || ''))
  if (wantItems) {
    const items = await extractGenericListItems(session!.page, itemLimit || 8)
    if (items.length) {
      const item = { url: urlNow, items }
      const endMeta = await buildEndMeta({
        ok: true,
        type: 'extract',
        via: 'generic_list',
        items: items.length,
        extractedDelta: items.length,
        pageUrlBefore,
        pageUrlAfter: urlNow,
        pageTitleAfter: String(state.pageTitle || ''),
        pageTextHashAfter: textDigest(String(state.pageText || '')),
        pageTextLenAfter: String(state.pageText || '').length
      })
      emitStepEnd(endMeta)
      return {
        stepCount,
        phase: 'acting',
        data: [...state.data, { ts: Date.now(), item, via: 'generic_list' }],
        extractedCount: extractedCountBefore + Math.max(0, Math.floor(items.length)),
        extractedCountBefore,
        route: 'verify',
        lastStepMeta: endMeta,
        failureType: ''
      }
    }
  }
  const item = await extractStructured(action.fields, state.pageText)
  if (state.stopAfterExtract) {
    const endMeta = await buildEndMeta({
      ok: true,
      type: 'extract',
      via: 'forced_extract',
      extractedDelta: 1,
      pageUrlBefore,
      pageUrlAfter: urlNow,
      pageTitleAfter: String(state.pageTitle || ''),
      pageTextHashAfter: textDigest(String(state.pageText || '')),
      pageTextLenAfter: String(state.pageText || '').length
    })
    emitStepEnd(endMeta)
    return {
      stepCount,
      phase: 'acting',
      data: [...state.data, { ts: Date.now(), item, via: 'forced_extract' }],
      extractedCount: extractedCountBefore + 1,
      extractedCountBefore,
      route: 'verify',
      lastStepMeta: endMeta,
      failureType: ''
    }
  }
  const unit = Array.isArray((item as any)?.items) ? Math.max(0, Math.floor(Number((item as any).items.length))) : 1
  const endMeta = await buildEndMeta({
    ok: true,
    type: 'extract',
    extractedDelta: unit,
    pageUrlBefore,
    pageUrlAfter: urlNow,
    pageTitleAfter: String(state.pageTitle || ''),
    pageTextHashAfter: textDigest(String(state.pageText || '')),
    pageTextLenAfter: String(state.pageText || '').length
  })
  emitStepEnd(endMeta)
  return {
    stepCount,
    phase: 'acting',
    data: [...state.data, { ts: Date.now(), item }],
    extractedCount: extractedCountBefore + unit,
    extractedCountBefore,
    route: 'verify',
    lastStepMeta: endMeta,
    failureType: ''
  }
}
