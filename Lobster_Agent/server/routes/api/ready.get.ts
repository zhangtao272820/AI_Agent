import { chromium } from 'playwright'
import {
  isLobsterDesktopMcpEnabled,
  isLobsterAndroidMcpEnabled,
  isLobsterMcpEnabled,
  isStagehandEnabled,
  resolveLobsterExecutionMode,
  lobsterMcpTransportMode,
} from '../../utils/lobster_env'
import { probeLobsterMcpReady } from '../../services/lobsterMcpAgent'
import { probeLobsterDesktopReady } from '../../services/lobsterDesktopMcpAgent'
import { probeLobsterAndroidReady } from '../../services/lobsterAndroidMcpAgent'
import { probeStagehandReady } from '../../services/lobsterStagehandAgent'
import {
  browserProfileLabel,
  isUserBrowserProfile,
  resolveBrowserCdpUrl,
  resolveBrowserProfile,
} from '../../services/browserProfiles'
import { listLobsterMcpToolNames, listLobsterSkillIds, loadLobsterSkillsManifest } from '../../utils/lobsterSkillLoader'

/** 总管 probe：health=进程存活，ready=至少一种执行引擎可用 */
export default defineEventHandler(async () => {
  const executionMode = resolveLobsterExecutionMode()
  let browserReady = false
  let detail = 'playwright_missing'
  try {
    const exe = chromium.executablePath()
    browserReady = Boolean(exe)
    detail = browserReady ? 'playwright_installed' : 'playwright_missing'
  } catch {
    detail = 'playwright_check_failed'
  }

  let mcp: { enabled: boolean; ok: boolean; toolCount: number; error?: string } = {
    enabled: isLobsterMcpEnabled(),
    ok: false,
    toolCount: 0
  }
  if (mcp.enabled) {
    const probe = await probeLobsterMcpReady()
    mcp = { enabled: true, ok: probe.ok, toolCount: probe.toolCount, error: probe.error }
  }

  let stagehand: { enabled: boolean; ok: boolean; error?: string } = {
    enabled: isStagehandEnabled(),
    ok: false
  }
  if (stagehand.enabled) {
    const probe = await probeStagehandReady()
    stagehand = { enabled: true, ok: probe.ok, error: probe.error }
  }

  let desktop: {
    enabled: boolean
    ok: boolean
    toolCount: number
    platform: string
    error?: string
  } = {
    enabled: isLobsterDesktopMcpEnabled(),
    ok: false,
    toolCount: 0,
    platform: process.platform
  }
  if (desktop.enabled) {
    const probe = await probeLobsterDesktopReady()
    desktop = {
      enabled: true,
      ok: probe.ok,
      toolCount: probe.toolCount,
      platform: process.platform,
      error: probe.error
    }
  } else if (process.platform !== 'win32') {
    desktop.error = 'requires_win32_host'
  }

  let android: {
    enabled: boolean
    ok: boolean
    toolCount: number
    deviceCount: number
    error?: string
    mode?: string
  } = {
    enabled: isLobsterAndroidMcpEnabled(),
    ok: false,
    toolCount: 0,
    deviceCount: 0,
  }
  if (android.enabled) {
    const probe = await probeLobsterAndroidReady()
    android = {
      enabled: true,
      ok: probe.ok,
      toolCount: probe.toolCount,
      deviceCount: probe.deviceCount,
      error: probe.error,
      mode: (probe as { mode?: string }).mode,
    }
  }

  const engines = {
    classic: { ok: browserReady, detail: browserReady ? 'playwright_installed' : detail },
    mcp: { ok: mcp.enabled && mcp.ok, toolCount: mcp.toolCount, error: mcp.error },
    stagehand: { ok: stagehand.enabled && stagehand.ok, error: stagehand.error },
    desktop: { ok: desktop.enabled && desktop.ok, toolCount: desktop.toolCount, error: desktop.error },
    mobile: { ok: android.enabled && android.ok, toolCount: android.toolCount, deviceCount: android.deviceCount, error: android.error },
  }

  const classicReady = browserReady
  const mcpReady = mcp.enabled && mcp.ok
  const stagehandReady = stagehand.enabled && stagehand.ok
  const desktopReady = desktop.enabled && desktop.ok
  const mobileReady = android.enabled && android.ok
  const ready =
    executionMode === 'mcp'
      ? mcpReady
      : executionMode === 'stagehand'
        ? stagehandReady
        : executionMode === 'classic'
          ? classicReady
          : mcpReady || stagehandReady || classicReady || desktopReady || mobileReady

  const browserProfile = resolveBrowserProfile()
  const browserCdpUrl = resolveBrowserCdpUrl()

  return {
    ok: true,
    ready,
    service: 'lobster-agent',
    executionMode,
    browser: browserReady ? 'installed' : 'missing',
    browserProfile: {
      mode: browserProfile,
      label: browserProfileLabel(browserProfile, browserCdpUrl || undefined),
      userActive: isUserBrowserProfile(),
      cdpConfigured: Boolean(browserCdpUrl),
    },
    mcpTransport: lobsterMcpTransportMode(),
    skillsManifest: loadLobsterSkillsManifest()
      ? { skills: listLobsterSkillIds(), mcp_tools: listLobsterMcpToolNames() }
      : undefined,
    mcp,
    stagehand,
    desktop,
    android,
    engines,
    detail,
    ts: Date.now()
  }
})
