/**
 * OTLP/HTTP JSON push to Tempo / Langfuse (or any OTLP collector).
 * No OpenTelemetry SDK dependency — maps manager-otel-v1 spans to ExportTraceServiceRequest.
 * Supports fan-out via MANAGER_OTLP_ENDPOINTS or MANAGER_OTLP_ENDPOINT + MANAGER_LANGFUSE_OTLP_ENDPOINT.
 */
import { readRunMetrics } from './runObservability'
import {
  buildOtelTracesFromMetrics,
  type OtelSpanExport,
  type OtelTraceExport
} from './otelExport'

const pushedRunIds = new Set<string>()

export function resolveOtlpEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.MANAGER_OTLP_ENDPOINT || '').trim()
}

/** All OTLP HTTP JSON endpoints to fan-out (deduped, order preserved). */
export function resolveOtlpEndpoints(env: NodeJS.ProcessEnv = process.env): string[] {
  const multi = String(env.MANAGER_OTLP_ENDPOINTS || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (multi.length) {
    return [...new Set(multi)]
  }
  const single = resolveOtlpEndpoint(env)
  const langfuse = String(env.MANAGER_LANGFUSE_OTLP_ENDPOINT || '').trim()
  const out: string[] = []
  if (single) out.push(single)
  if (langfuse && langfuse !== single) out.push(langfuse)
  return out
}

export function isManagerOtlpPushEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = String(env.MANAGER_OTLP_PUSH ?? '1').trim().toLowerCase()
  if (flag === '0' || flag === 'false' || flag === 'off' || flag === 'no') return false
  return resolveOtlpEndpoints(env).length > 0
}

function buildOtlpHeaders(endpoint: string, env: NodeJS.ProcessEnv): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const isLangfuse =
    endpoint.includes('langfuse') || endpoint.includes('/api/public/otel')
  const pk = String(env.LANGFUSE_PUBLIC_KEY || '').trim()
  const sk = String(env.LANGFUSE_SECRET_KEY || '').trim()
  if (isLangfuse && pk && sk) {
    headers.Authorization = `Basic ${Buffer.from(`${pk}:${sk}`).toString('base64')}`
  }
  const extra = String(env.MANAGER_OTLP_HEADERS || '').trim()
  if (extra) {
    for (const part of extra.split(';')) {
      const idx = part.indexOf('=')
      if (idx <= 0) continue
      const k = part.slice(0, idx).trim()
      const v = part.slice(idx + 1).trim()
      if (k && v) headers[k] = v
    }
  }
  return headers
}

/** OTLP protobuf-JSON encodes bytes as base64. */
export function hexToOtlpBytes(hex: string): string {
  const clean = String(hex || '')
    .replace(/[^a-fA-F0-9]/g, '')
    .toLowerCase()
  const padded = clean.length % 2 ? `0${clean}` : clean
  return Buffer.from(padded || '00', 'hex').toString('base64')
}

function attrKeyValue(key: string, value: string | number): Record<string, unknown> {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { key, value: { intValue: String(Math.trunc(value)) } }
  }
  return { key, value: { stringValue: String(value) } }
}

function spanToOtlp(span: OtelSpanExport): Record<string, unknown> {
  const attrs = span.attributes || {}
  return {
    traceId: hexToOtlpBytes(span.traceId),
    spanId: hexToOtlpBytes(span.spanId),
    name: span.name,
    kind: 1,
    startTimeUnixNano: span.startTimeUnixNano,
    endTimeUnixNano: span.endTimeUnixNano,
    attributes: Object.entries(attrs).map(([k, v]) => attrKeyValue(k, v))
  }
}

/** Build OTLP/HTTP JSON body from manager-otel-v1 traces (exported for smoke). */
export function buildOtlpExportBody(traces: OtelTraceExport[]): Record<string, unknown> {
  const scopeSpans = traces
    .filter((t) => t.spans.length > 0)
    .map((t) => ({
      scope: { name: 'manager-agent', version: 'manager-otel-v1' },
      spans: t.spans.map(spanToOtlp)
    }))
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            attrKeyValue('service.name', 'manager_agent'),
            attrKeyValue('telemetry.sdk.name', 'clawhive-manager-otlp')
          ]
        },
        scopeSpans
      }
    ]
  }
}

export type OtlpPushResult = {
  ok: boolean
  skipped?: boolean
  reason?: string
  status?: number
  spanCount?: number
  endpoints?: string[]
  results?: Array<{ endpoint: string; ok: boolean; status?: number; reason?: string }>
}

async function pushOneEndpoint(
  endpoint: string,
  body: Record<string, unknown>,
  spanCount: number,
  fetchImpl: typeof fetch,
  env: NodeJS.ProcessEnv
): Promise<OtlpPushResult> {
  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: buildOtlpHeaders(endpoint, env),
      body: JSON.stringify(body)
    })
    if (!res.ok) {
      return { ok: false, status: res.status, spanCount, reason: `http_${res.status}` }
    }
    return { ok: true, status: res.status, spanCount }
  } catch (e: any) {
    return { ok: false, spanCount, reason: String(e?.message || e || 'fetch_failed') }
  }
}

export async function pushOtlpTraces(
  traces: OtelTraceExport[],
  opts?: {
    endpoint?: string
    fetchImpl?: typeof fetch
    env?: NodeJS.ProcessEnv
  }
): Promise<OtlpPushResult> {
  const env = opts?.env || process.env
  if (!isManagerOtlpPushEnabled(env)) {
    return { ok: true, skipped: true, reason: 'otlp_push_disabled' }
  }
  const endpoints = opts?.endpoint
    ? [String(opts.endpoint).trim()].filter(Boolean)
    : resolveOtlpEndpoints(env)
  if (!endpoints.length) {
    return { ok: true, skipped: true, reason: 'no_endpoint' }
  }
  const spanCount = traces.reduce((n, t) => n + t.spans.length, 0)
  if (!spanCount) {
    return { ok: true, skipped: true, reason: 'no_spans', spanCount: 0 }
  }
  const body = buildOtlpExportBody(traces)
  const fetchImpl = opts?.fetchImpl || fetch
  const results: Array<{ endpoint: string; ok: boolean; status?: number; reason?: string }> = []
  for (const endpoint of endpoints) {
    const one = await pushOneEndpoint(endpoint, body, spanCount, fetchImpl, env)
    results.push({
      endpoint,
      ok: Boolean(one.ok),
      status: one.status,
      reason: one.reason
    })
  }
  const anyOk = results.some((r) => r.ok)
  const allOk = results.every((r) => r.ok)
  return {
    ok: anyOk,
    status: allOk ? 200 : anyOk ? 207 : results[0]?.status,
    spanCount,
    endpoints,
    results,
    reason: allOk ? undefined : results.filter((r) => !r.ok).map((r) => r.reason).join(';')
  }
}

/** Finalize hook: export one run's metrics as OTLP once (fire-and-forget safe). */
export async function pushOtlpTraceForRun(
  runId: string,
  opts?: {
    dataDir?: string
    endpoint?: string
    fetchImpl?: typeof fetch
    env?: NodeJS.ProcessEnv
    force?: boolean
  }
): Promise<OtlpPushResult> {
  const rid = String(runId || '').trim()
  if (!rid) return { ok: true, skipped: true, reason: 'empty_run_id' }
  if (!opts?.force && pushedRunIds.has(rid)) {
    return { ok: true, skipped: true, reason: 'already_pushed' }
  }
  const env = opts?.env || process.env
  if (!isManagerOtlpPushEnabled(env)) {
    return { ok: true, skipped: true, reason: 'otlp_push_disabled' }
  }
  const rows = await readRunMetrics(rid, opts?.dataDir)
  const traces = buildOtelTracesFromMetrics(rows, 1)
  const result = await pushOtlpTraces(traces, {
    endpoint: opts?.endpoint,
    fetchImpl: opts?.fetchImpl,
    env
  })
  if (result.ok && !result.skipped) {
    pushedRunIds.add(rid)
    if (pushedRunIds.size > 2000) {
      const first = pushedRunIds.values().next().value
      if (first) pushedRunIds.delete(first)
    }
  }
  return result
}

/** Test helper: clear dedupe set. */
export function resetOtlpPushDedupeForTests() {
  pushedRunIds.clear()
}
