import fs from 'node:fs/promises'
import path from 'node:path'
import {
  buildAgentRegistry,
  type ToolHealthAgentRow
} from '../../core/agent/agentRegistry'
import type { CapabilityId } from '../../core/agent/capabilities'
import { probeHttpHealth, probeHttpService } from '../../core/probe/agentProbe'
import { probeServiceReady } from '../../core/runtime/serviceReady'
import { isManagerDockerRuntime } from '../../../utils/platform/managerEnvModes'

import type { CreateToolHealthNodeDeps } from './types'

function liveProbeEnabled() {
  return String(process.env.MANAGER_TOOL_HEALTH_LIVE_PROBE ?? '1').trim() !== '0'
}

/** 运行时以 WebSocket 为主、HTTP 仅作辅助探测的 Agent */
const WS_PRIMARY_AGENTS = new Set<CapabilityId>(['db', 'code', 'crawler', 'gui', 'admin', 'music', 'video'])

function transportLabel(entry: { httpBase?: string; wsUrl?: string; mode: string }) {
  if (entry.mode === 'internal') return 'internal'
  if (entry.wsUrl && entry.httpBase) return 'ws+http'
  if (entry.wsUrl) return 'ws'
  if (entry.httpBase) return 'http'
  return '—'
}

export function createToolHealthNode(deps: CreateToolHealthNodeDeps) {
  const { opts, policyDir, safeJsonParse, percentile } = deps

  return async (_state: any) => {
    opts.sendEvent({ event: 'phase', data: 'tool_health', from: 'manager' })
    const registry = buildAgentRegistry()
    const phaseMap: Record<string, string> = {
      db: 'db',
      rag: 'rag',
      code: 'code',
      crawler: 'crawler',
      gui: 'gui',
      admin: 'admin',
      clean: 'clean',
      visualize: 'visualize',
      report: 'report',
      multimodal: 'multimodal',
      music: 'music',
      video: 'video'
    }

    const byPhase = new Map<string, number[]>()
    const skipByAgent = new Map<string, number>()
    try {
      const metricsPath = path.join(policyDir, 'manager-metrics.jsonl')
      const text = await fs.readFile(metricsPath, 'utf8').catch(() => '')
      const lines = text.split('\n').filter((l) => l.trim()).slice(-1200)
      for (const line of lines) {
        const obj = safeJsonParse(line) as any
        const phase = String(obj?.phase || '').trim()
        const ms = Number(obj?.ms || 0)
        if (phase === 'step_skip') {
          const ag = String(obj?.extra?.agent || '').trim()
          if (ag) skipByAgent.set(ag, (skipByAgent.get(ag) || 0) + 1)
          continue
        }
        if (!phase || !Number.isFinite(ms) || ms < 0) continue
        const arr = byPhase.get(phase) || []
        arr.push(ms)
        byPhase.set(phase, arr)
      }
    } catch {}

    const docker = isManagerDockerRuntime(process.env)
    const latencyMul = docker ? Number(process.env.MANAGER_DOCKER_LATENCY_MUL ?? 2.5) : 1
    const scaleMs = (n: number) => Math.round(n * (Number.isFinite(latencyMul) && latencyMul > 0 ? latencyMul : 1))
    const latencyThreshold: Partial<Record<CapabilityId, number>> = {
      rag: scaleMs(12_000),
      db: scaleMs(25_000),
      code: scaleMs(20_000),
      crawler: scaleMs(35_000),
      gui: scaleMs(120_000),
      admin: scaleMs(18_000),
      clean: scaleMs(12_000),
      visualize: scaleMs(15_000),
      report: scaleMs(15_000),
      multimodal: scaleMs(22_000),
      music: scaleMs(45_000),
      video: scaleMs(90_000)
    }

    const agents: ToolHealthAgentRow[] = []
    for (const entry of registry.entries) {
      const agent = entry.id
      const phase = phaseMap[agent] || agent
      const arr = byPhase.get(phase) || []
      const samples = arr.length
      const avgMs = samples ? Math.round(arr.reduce((a, b) => a + b, 0) / samples) : 0
      const p95Ms = samples ? percentile(arr, 0.95) : 0
      const endpoint = entry.httpBase || entry.wsUrl || (entry.mode === 'internal' ? 'internal' : '')
      const downByConfig = entry.mode === 'external' && !endpoint

      let liveProbe: ToolHealthAgentRow['liveProbe'] = 'skip'
      if (liveProbeEnabled() && entry.mode === 'external') {
        if (entry.httpBase) {
          if (agent === 'crawler' || agent === 'gui') {
            const ready = await probeServiceReady(entry.httpBase)
            liveProbe = ready.ready ? 'ok' : ready.healthOk ? 'fail' : 'fail'
          } else {
            liveProbe =
              agent === 'db' || agent === 'rag'
                ? await probeHttpService(entry.httpBase, {
                    healthPath: entry.healthPath,
                    probePath: entry.probePath
                  })
                : await probeHttpHealth(entry.httpBase, entry.healthPath || '/api/health')
          }
        } else if (entry.wsUrl) {
          liveProbe = 'skip'
        }
      }

      const thresh = latencyThreshold[agent] ?? 20_000
      const degradedByLatency = samples >= 2 && p95Ms > thresh && liveProbe !== 'ok'
      const skips = skipByAgent.get(agent) || 0
      const degradedBySkips =
        ['db', 'rag', 'code', 'crawler', 'gui', 'admin', 'multimodal', 'music', 'video'].includes(agent) &&
        skips >= 4 &&
        liveProbe !== 'ok'
      const wsPrimary = WS_PRIMARY_AGENTS.has(agent) && Boolean(entry.wsUrl)
      // 纯 HTTP 探测失败且无 WS：可标 offline；有 WS 的 Agent（如 db）不因 /api/health 缺失而判死
      const downByLive = liveProbe === 'fail' && !wsPrimary && !samples

      let status: ToolHealthAgentRow['status'] = 'unknown'
      if (downByConfig) status = 'down'
      else if (downByLive) status = 'down'
      else if (wsPrimary && samples >= 1) {
        status = degradedBySkips || degradedByLatency ? 'degraded' : 'healthy'
      } else if (wsPrimary && liveProbe === 'fail') {
        status = degradedBySkips || degradedByLatency ? 'degraded' : 'unknown'
      } else if (liveProbe === 'fail' && entry.wsUrl) {
        status = degradedByLatency || degradedBySkips ? 'degraded' : 'unknown'
      } else if (samples < 2 && liveProbe === 'ok') status = 'healthy'
      else if (samples < 2) status = 'unknown'
      else if (degradedBySkips || degradedByLatency) status = 'degraded'
      else status = 'healthy'

      agents.push({
        agent,
        status,
        avgMs,
        p95Ms,
        samples,
        stepSkipCount: skips,
        endpoint: endpoint || undefined,
        liveProbe,
        transport: transportLabel(entry)
      })
    }

    const counts = agents.reduce(
      (acc, a) => {
        acc[a.status] += 1
        return acc
      },
      { healthy: 0, degraded: 0, down: 0, unknown: 0 } as Record<ToolHealthAgentRow['status'], number>
    )
    const summary = `健康=${counts.healthy}，降级=${counts.degraded}，离线=${counts.down}，未知=${counts.unknown}`
    const snapshot = {
      updatedAt: new Date().toISOString(),
      summary,
      registryVersion: registry.updatedAt,
      agents
    }
    opts.sendEvent({ event: 'thinking', data: `Tool Health Agent：${summary}`, from: 'manager' })
    opts.sendEvent({ event: 'health', data: snapshot, from: 'manager' })
    try {
      await fs.mkdir(policyDir, { recursive: true }).catch(() => undefined)
      await fs.writeFile(path.join(policyDir, 'manager-tool-health.json'), JSON.stringify(snapshot, null, 2), 'utf8')
    } catch {}
    return { toolHealth: snapshot }
  }
}

