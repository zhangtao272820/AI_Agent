/**
 * 路由 golden 结构性期望（仅 eval/CI 门禁，不参与生产路由决策）。
 */

const GUI_INTERACTIVE = ['登录', '填表', '点击', '提交', '后台', '截图', '交互']
const CRAWLER_STATIC = ['抓取', '爬取', '列表', '提取', '资讯列表']
const REALTIME = ['今天', '汇率', '多少', '实时', '最新', '搜索一下']
const MEDIA_GEN = ['生成音乐', '生成视频', 'bgm', '纯音乐', '配乐']
const MEDIA_VISION = ['描述', '识图', '图中', '图片里', '分析图']

function hasAny(text, terms) {
  const t = String(text || '').toLowerCase()
  return terms.some((w) => t.includes(String(w).toLowerCase()))
}

function hasUrl(text) {
  return /https?:\/\//i.test(String(text || ''))
}

/**
 * @param {string} query
 * @param {{ hasAttachment?: boolean }} [opts]
 */
export function structuralRouteExpectation(query, opts = {}) {
  const q = String(query || '').trim()
  const hasAttachment = opts.hasAttachment === true

  if (hasAttachment && hasAny(q, MEDIA_GEN)) {
    return {
      expectIntent: 'multi',
      expectAllowedIncludes: ['multimodal'],
      expectAllowedExcludes: [],
      needsWebSearch: false,
      secondaryAgents: q.includes('音乐') || q.includes('bgm') ? ['music'] : q.includes('视频') ? ['video'] : []
    }
  }

  if (hasAttachment && (hasAny(q, MEDIA_VISION) || q.length <= 40)) {
    return {
      expectIntent: 'multimodal',
      expectAllowedIncludes: ['multimodal'],
      expectAllowedExcludes: ['music', 'video', 'gui', 'crawler'],
      needsWebSearch: false
    }
  }

  const mediaWebRef = /参考|流行|对标|同款|热门|曲风|20\d{2}/i.test(q)
  if (
    !hasAttachment &&
    (hasAny(q, ['bgm', '纯音乐', '配乐', '生成音乐', '生成一段']) || q.includes('音乐')) &&
    mediaWebRef
  ) {
    return {
      expectIntent: 'music',
      expectAllowedIncludes: ['music'],
      expectAllowedExcludes: ['multimodal', 'gui'],
      needsWebSearch: true
    }
  }

  if (hasAny(q, ['生成音乐', 'bgm', '纯音乐', '配乐']) && !hasAttachment) {
    return {
      expectIntent: 'music',
      expectAllowedIncludes: ['music'],
      expectAllowedExcludes: ['multimodal', 'gui'],
      needsWebSearch: false
    }
  }

  const strongInteractive =
    hasAny(q, ['登录', '填表', '点击', '提交', '后台', '截图', '交互', '打开']) ||
    (hasUrl(q) && /打开|点击|进入/.test(q)) ||
    (/打开.{0,12}(百度|谷歌|google|bing|浏览器)|打开.{0,8}搜索/i.test(q) &&
      /提取|第一条|首个|第一条结果/.test(q))
  if (strongInteractive) {
    return {
      expectIntent: 'gui',
      expectAllowedIncludes: ['gui'],
      expectAllowedExcludes: [],
      needsWebSearch: false
    }
  }

  if (hasAny(q, CRAWLER_STATIC) || (hasUrl(q) && /抓取|爬/.test(q))) {
    return {
      expectIntent: 'crawler',
      expectAllowedIncludes: ['crawler'],
      expectAllowedExcludes: ['gui'],
      needsWebSearch: false
    }
  }

  if (hasAny(q, REALTIME)) {
    return {
      expectIntent: 'multi',
      expectAllowedIncludes: ['crawler'],
      expectAllowedExcludes: ['gui'],
      needsWebSearch: true
    }
  }

  return {
    expectIntent: null,
    expectAllowedIncludes: [],
    expectAllowedExcludes: [],
    needsWebSearch: false
  }
}

/**
 * @param {Record<string, unknown>} c
 */
export function assertRouteCaseStructural(c) {
  const query = String(c.query || '').trim()
  if (!query) throw new Error('route case: query required')

  const exp = structuralRouteExpectation(query, { hasAttachment: c.hasAttachment === true })
  if (!exp.expectIntent) return

  if (c.expectIntent && String(c.expectIntent) !== exp.expectIntent) {
    throw new Error(
      `${c.id}: expectIntent mismatch — golden=${c.expectIntent} structural=${exp.expectIntent}`
    )
  }

  const includes = Array.isArray(c.expectAllowedIncludes) ? c.expectAllowedIncludes : []
  for (const agent of exp.expectAllowedIncludes) {
    if (includes.length && !includes.includes(agent)) {
      throw new Error(`${c.id}: expectAllowedIncludes should include ${agent}`)
    }
  }

  const excludes = Array.isArray(c.expectAllowedExcludes) ? c.expectAllowedExcludes : []
  for (const agent of exp.expectAllowedExcludes) {
    if (!excludes.includes(agent)) {
      throw new Error(`${c.id}: expectAllowedExcludes should include ${agent}`)
    }
  }

  if (c.expectNeedsWebSearch === true && !exp.needsWebSearch) {
    throw new Error(`${c.id}: expectNeedsWebSearch=true but structural hint says false`)
  }

  if (Array.isArray(exp.secondaryAgents) && exp.secondaryAgents.length) {
    for (const agent of exp.secondaryAgents) {
      if (!includes.includes(agent)) {
        throw new Error(`${c.id}: multimodal+media case should include ${agent}`)
      }
    }
  }
}
