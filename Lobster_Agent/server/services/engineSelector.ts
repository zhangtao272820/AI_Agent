/** 任务级执行引擎选型（classic | mcp | stagehand | desktop） */

export type LobsterEngineId = 'classic' | 'mcp' | 'stagehand' | 'desktop' | 'mobile'

const VIDEO_RE = /(播放|观看|视频|弹幕|B站|bilibili|哔哩|网易云|music\.163)/i
const ENGAGEMENT_RE = /(点赞|投币|收藏|一键\s*三连|三\s*连|关注)/i
const BILI_HOST_RE = /bilibili\.com|b23\.tv/i
const FORM_RE = /(登录|填表|提交|OA|后台|表单|注册|用户名|密码|SPA|React|Vue|Element|Ant\s*Design)/i
const EXTRACT_RE = /(抽取|提取|获取|搜索|search|点击|打开|列表|JSON)/i
const DESKTOP_RE =
  /(记事本|Notepad|桌面|Windows\s*应用|原生应用|Excel|Word|PowerPoint|设置|控制面板|资源管理器|Explorer|保存到桌面|Win\s*App|UWP|系统设置)/i
const MOBILE_RE =
  /(Android|安卓|手机|ADB|adb|点击屏幕|打开微信|打开支付宝|打开设置|安装应用|App\s*内)/i

/** 播放/观看/B站互动必须用 classic（可见浏览器 + vision），不可被 LLM 覆盖为 mcp */
export function requiresClassicEngine(task: string, startUrl?: string): boolean {
  const blob = `${String(task || '').trim()} ${String(startUrl || '').trim()}`
  if (VIDEO_RE.test(blob)) return true
  if (ENGAGEMENT_RE.test(blob) && BILI_HOST_RE.test(blob)) return true
  return false
}

/** Android 设备任务 → mobile 引擎（需 LOBSTER_ANDROID_MCP_ENABLED + adb device） */
export function requiresMobileEngine(task: string, startUrl?: string): boolean {
  const url = String(startUrl || '').trim()
  if (url && /^https?:\/\//i.test(url)) return false
  return MOBILE_RE.test(String(task || '').trim())
}

/** Windows 原生桌面应用任务 → desktop 引擎（需 LOBSTER_DESKTOP_MCP_ENABLED） */
export function requiresDesktopEngine(task: string, startUrl?: string): boolean {
  if (requiresMobileEngine(task, startUrl)) return false
  const blob = `${String(task || '').trim()} ${String(startUrl || '').trim()}`
  if (startUrl && /^https?:\/\//i.test(startUrl)) return false
  return DESKTOP_RE.test(blob)
}

export function isEngineSelectorEnabled(): boolean {
  return String(process.env.LOBSTER_ENGINE_SELECTOR ?? '1').trim() !== '0'
}

export function selectEngineForTask(
  task: string,
  startUrl?: string,
  opts?: { hasStorage?: boolean }
): LobsterEngineId {
  const t = String(task || '').trim()
  const url = String(startUrl || '').trim()
  const blob = `${t} ${url}`

  if (VIDEO_RE.test(blob)) return 'classic'
  if (ENGAGEMENT_RE.test(blob) && BILI_HOST_RE.test(blob)) return 'classic'
  if (opts?.hasStorage && FORM_RE.test(blob)) return 'stagehand'
  if (FORM_RE.test(blob)) return 'stagehand'
  if (EXTRACT_RE.test(blob)) return 'mcp'
  return 'mcp'
}

/** auto 模式下的 fallback 链（主引擎失败后依次尝试） */
export function engineFallbackChain(primary: LobsterEngineId): LobsterEngineId[] {
  const uniq = (xs: LobsterEngineId[]) => xs.filter((x, i) => xs.indexOf(x) === i)
  if (primary === 'desktop') return ['desktop']
  if (primary === 'mobile') return ['mobile']
  if (primary === 'stagehand') return uniq(['stagehand', 'mcp', 'classic'])
  if (primary === 'mcp') return uniq(['mcp', 'stagehand', 'classic'])
  return uniq(['classic', 'mcp', 'stagehand'])
}

export function resolvePrimaryEngine(
  task: string,
  startUrl?: string,
  forced?: string,
  opts?: { hasStorage?: boolean }
): LobsterEngineId {
  const raw = String(forced || '').trim().toLowerCase()
  if (raw === 'classic' || raw === 'mcp' || raw === 'stagehand' || raw === 'desktop' || raw === 'mobile') return raw
  if (!isEngineSelectorEnabled()) return 'mcp'
  if (requiresMobileEngine(task, startUrl)) return 'mobile'
  if (requiresDesktopEngine(task, startUrl)) return 'desktop'
  return selectEngineForTask(task, startUrl, opts)
}
