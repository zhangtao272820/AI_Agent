export type TargetSite =
  | 'douban'
  | 'zhihu'
  | 'weibo'
  | 'bilibili'
  | 'toutiao'
  | 'douyin'
  | 'jd'
  | 'qqmusic'
  | 'kugou'
  | 'generic'

export type ContentType = 'ranking' | 'news' | 'products' | 'qa' | 'videos' | 'music' | 'generic'

export type { CapabilityProfile, SitePatch } from './patchRegistry'
export {
  getCapabilityProfile,
  getPatchAntiBotRisk,
  getSitePatches,
  listPatchSummary,
  resolvePatchByUrl,
  resolvePatchForTask,
} from './patchRegistry'
