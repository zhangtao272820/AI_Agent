export type CandidateFlagName = 'isButtonish' | 'isLinkish' | 'isInputish'

export type CandidateTarget = 'text' | 'label' | 'href'

export type CandidateCondition =
  | { kind: 'matchAny'; target: CandidateTarget; patterns: RegExp[]; delta: number; requires?: CandidateFlagName[] }
  | {
      kind: 'primaryMatchAny'
      target: CandidateTarget
      patterns: RegExp[]
      matchDelta: number
      noMatchDelta: number
      requires?: CandidateFlagName[]
    }
  | { kind: 'flag'; flag: CandidateFlagName; delta: number; requires?: CandidateFlagName[] }
  | { kind: 'flagAny'; flags: CandidateFlagName[]; delta: number; requires?: CandidateFlagName[] }
  | { kind: 'labelLenGte'; min: number; delta: number; requires?: CandidateFlagName[] }
  | {
      kind: 'labelLenGteAndNotMatchAny'
      min: number
      target: CandidateTarget
      patterns: RegExp[]
      delta: number
      requires?: CandidateFlagName[]
    }

export type IntentScoreRule = { conditions: CandidateCondition[] }

export const intentAliasMap: Record<string, string> = {
  play: 'play',
  播放: 'play',
  watch: 'play',
  fullscreen: 'fullscreen',
  full: 'fullscreen',
  全屏: 'fullscreen',
  like: 'like',
  赞: 'like',
  点赞: 'like',
  coin: 'coin',
  投币: 'coin',
  favorite: 'favorite',
  收藏: 'favorite',
  follow: 'follow',
  关注: 'follow',
  next: 'next',
  next_page: 'next',
  下一页: 'next',
  close: 'close',
  关闭: 'close',
  login: 'login',
  登录: 'login',
  quality: 'quality',
  清晰度: 'quality',
  画质: 'quality',
  分辨率: 'quality',
  rate: 'rate',
  倍速: 'rate',
  speed: 'rate',
  danmaku: 'danmaku',
  弹幕: 'danmaku',
  comment: 'comment',
  评论: 'comment'
}

export const globalIntentScoring = {
  // 顶层“危险词”惩罚（避免误点交易/订阅等）
  badLabelRe: /(购买|支付|下单|提交订单|确认支付|删除|移除|退订|开通|订阅|充值|投稿|上传|发布视频|发布动态)/i,
  badLabelPenalty: -60,
  adLabelRe: /(广告|ad|赞助|sponsor)/i,
  adLabelPenalty: -8,
  emptyTextPenalty: -2,
  base: {
    isButtonish: 8,
    isLinkish: 5,
    isInputish: 1,
    hasAnyText: 1
  },
  pickMinScore: 12
}

export const intentScoreRules: Record<string, IntentScoreRule> = {
  play: {
    conditions: [
      { kind: 'matchAny', target: 'text', patterns: [/播放|play|继续播放|开始播放|▶|watch/], delta: 30 },
      { kind: 'matchAny', target: 'text', patterns: [/暂停|pause/], delta: 8 },
      { kind: 'matchAny', target: 'text', patterns: [/视频|video/], delta: 6 },
      { kind: 'flag', flag: 'isLinkish', delta: 6 },
      { kind: 'matchAny', target: 'href', patterns: [/\/video\/[a-z0-9]+/i], delta: 70 },
      {
        kind: 'labelLenGteAndNotMatchAny',
        requires: ['isLinkish'],
        min: 6,
        target: 'text',
        patterns: [/搜索|历史|排行|直播|频道|帮助|下载|注册|登录|settings|profile/],
        delta: 18
      },
      { kind: 'labelLenGte', requires: ['isLinkish'], min: 12, delta: 6 },
      { kind: 'matchAny', target: 'text', patterns: [/最多播放|播放量|按播放|播放排序|排序|综合排序|最新发布|筛选|过滤/], delta: -40 }
    ]
  },
  like: {
    conditions: [
      {
        kind: 'primaryMatchAny',
        target: 'text',
        patterns: [/点赞|like|赞(?!助)/],
        matchDelta: 30,
        noMatchDelta: -80
      },
      { kind: 'matchAny', target: 'text', patterns: [/取消赞|已赞|liked/], delta: 10 },
      { kind: 'flag', flag: 'isButtonish', delta: 6 }
    ]
  },
  coin: {
    conditions: [
      {
        kind: 'primaryMatchAny',
        target: 'text',
        patterns: [/投币|coin/],
        matchDelta: 30,
        noMatchDelta: -80
      },
      { kind: 'matchAny', target: 'text', patterns: [/硬币/], delta: 6 },
      { kind: 'flag', flag: 'isButtonish', delta: 6 }
    ]
  },
  favorite: {
    conditions: [
      {
        kind: 'primaryMatchAny',
        target: 'text',
        patterns: [/收藏|favorite|star|加入收藏/],
        matchDelta: 28,
        noMatchDelta: -80
      },
      { kind: 'matchAny', target: 'text', patterns: [/已收藏|取消收藏/], delta: 10 },
      { kind: 'flag', flag: 'isButtonish', delta: 6 }
    ]
  },
  follow: {
    conditions: [
      {
        kind: 'primaryMatchAny',
        target: 'text',
        patterns: [/关注|follow|订阅|subscribe/],
        matchDelta: 28,
        noMatchDelta: -80
      },
      { kind: 'matchAny', target: 'text', patterns: [/已关注|取消关注|following/], delta: 10 },
      { kind: 'flag', flag: 'isButtonish', delta: 6 }
    ]
  },
  fullscreen: {
    conditions: [
      {
        kind: 'primaryMatchAny',
        target: 'text',
        patterns: [/全屏|fullscreen/],
        matchDelta: 26,
        noMatchDelta: -80
      },
      { kind: 'flag', flag: 'isButtonish', delta: 6 }
    ]
  },
  next: {
    conditions: [
      { kind: 'matchAny', target: 'text', patterns: [/下一页|下页|next page|next\b|更多|more|load more|more results|更多结果/], delta: 26 },
      { kind: 'matchAny', target: 'text', patterns: [/上一页|previous|prev\b|back to results|返回结果|返回列表/], delta: -20 },
      { kind: 'flagAny', flags: ['isLinkish', 'isButtonish'], delta: 6 }
    ]
  },
  close: {
    conditions: [
      { kind: 'matchAny', target: 'text', patterns: [/关闭|关\s*闭|取消|我知道了|知道了|accept|ok|close|dismiss/], delta: 24 },
      { kind: 'flag', flag: 'isButtonish', delta: 6 }
    ]
  },
  login: {
    conditions: [
      { kind: 'matchAny', target: 'text', patterns: [/登录|log in|sign in/], delta: 24 },
      { kind: 'flagAny', flags: ['isButtonish', 'isLinkish'], delta: 6 }
    ]
  },
  quality: {
    conditions: [
      {
        kind: 'matchAny',
        target: 'text',
        patterns: [/清晰度|画质|quality|resolution|1080p|720p|480p|360p|4k|8k|原画|蓝光/],
        delta: 28
      },
      { kind: 'flag', flag: 'isButtonish', delta: 8 }
    ]
  },
  rate: {
    conditions: [
      { kind: 'matchAny', target: 'text', patterns: [/倍速|播放速度|playback|speed|0\.5x|1\.25x|1\.5x|2x/], delta: 28 },
      { kind: 'flag', flag: 'isButtonish', delta: 8 }
    ]
  },
  danmaku: {
    conditions: [
      { kind: 'matchAny', target: 'text', patterns: [/弹幕|danmaku/], delta: 26 },
      { kind: 'flag', flag: 'isButtonish', delta: 8 }
    ]
  },
  comment: {
    conditions: [
      { kind: 'matchAny', target: 'text', patterns: [/评论|发评|发送评论|回复|说点什么|友善发言|comment|reply/], delta: 26 },
      { kind: 'flag', flag: 'isInputish', delta: 10 },
      { kind: 'flag', flag: 'isButtonish', delta: 4 }
    ]
  }
}

export const genericFirstResultConfig = {
  badLabelRe: /(登录|注册|sign in|log in|广告|赞助|sponsor|cookie|隐私|协议|设置|帮助|下载|download|app|open app)/i,
  dangerousRe: /(购买|支付|下单|提交订单|确认支付|删除|移除|退订|开通|订阅|充值)/i,
  goodLabelRe: /(详情|detail|查看|进入|打开|read|more|继续|continue|go to)/i,
  badHrefRe: /javascript:|mailto:|tel:|#$/i,
  blackboardSkipRe: /\/(blackboard|activity|promotion)\b/i
}

export const detailLinkConfig = {
  badPathRe: /(\/passport\b|\/login\b|\/signin\b|\/signup\b|\/register\b|\/account\b|\/download\b|\/app\b)/i,
  badLabelRe: /(查看详情|了解更多|活动|领取|下载|打开app|open app|稍后再看)/i,
  blackboardSkipRe: /\/blackboard\//i,
  // path is accepted when either a video path or a common "detail-ish" path matches
  videoPathRe: /\/video\/[a-z0-9]+/i,
  detailishPathRe: /\/(detail|item|product|post|article|news|read|story|p)(\/|$)/i,
  bbox: {
    y1Base: 900,
    y1Div: 90,
    x1Base: 600,
    x1Div: 240
  },
  labelLenBoost: { min6: 4, min12: 3, badLabelPenalty: -22 },
  pathBoost: { video: 60, other: 35 }
}

export const pickThreshold = {
  pickCandidateByIntent: { minScore: 12 },
  rankedByIntent: { minScore: 12 },
  genericFirst: { minScore: 8 }
}

