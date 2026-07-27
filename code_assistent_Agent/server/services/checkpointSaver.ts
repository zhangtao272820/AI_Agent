import fs from 'node:fs/promises'
import path from 'node:path'
import type { RunnableConfig } from '@langchain/core/runnables'
import {
  BaseCheckpointSaver,
  copyCheckpoint,
  getCheckpointId,
  WRITES_IDX_MAP,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointTuple
} from '@langchain/langgraph-checkpoint'
import { TASKS } from '@langchain/langgraph-checkpoint'

type StorageValue = [string, string, string | undefined]
type WritesValue = [string, string, string]

type Persisted = {
  storage: Record<string, Record<string, Record<string, StorageValue>>>
  writes: Record<string, Record<string, WritesValue>>
}

function toB64(u8: Uint8Array) {
  return Buffer.from(u8).toString('base64')
}

function fromB64(b64: string) {
  return new Uint8Array(Buffer.from(b64, 'base64'))
}

function key(threadId: string, checkpointNamespace: string, checkpointId: string) {
  return JSON.stringify([threadId, checkpointNamespace, checkpointId])
}

export class FileSaver extends BaseCheckpointSaver {
  private filePath: string
  private loaded = false
  private writing: Promise<void> = Promise.resolve()
  storage: Persisted['storage'] = {}
  writes: Persisted['writes'] = {}

  constructor(params?: { filePath?: string }) {
    super()
    const p = params?.filePath || process.env.CHECKPOINT_FILE || path.join(process.cwd(), '.data', 'langgraph-checkpoints.json')
    this.filePath = path.resolve(p)
  }

  private async ensureLoaded() {
    if (this.loaded) return
    this.loaded = true
    const dir = path.dirname(this.filePath)
    await fs.mkdir(dir, { recursive: true }).catch(() => {})
    const raw = await fs.readFile(this.filePath, 'utf8').catch(() => '')
    if (!raw.trim()) return
    try {
      const parsed = JSON.parse(raw) as Persisted
      this.storage = parsed.storage || {}
      this.writes = parsed.writes || {}
    } catch {
      this.storage = {}
      this.writes = {}
    }
  }

  private async flush() {
    const data: Persisted = { storage: this.storage, writes: this.writes }
    const dir = path.dirname(this.filePath)
    await fs.mkdir(dir, { recursive: true }).catch(() => {})
    const tmp = `${this.filePath}.tmp`
    await fs.writeFile(tmp, JSON.stringify(data), 'utf8')
    await fs.rename(tmp, this.filePath)
  }

  private enqueueFlush() {
    this.writing = this.writing.then(() => this.flush()).catch(() => {})
    return this.writing
  }

  private async getPendingSends(threadId: string, checkpointNs: string, parentCheckpointId?: string) {
    let pendingSends: any[] = []
    if (parentCheckpointId !== undefined) {
      const k = key(threadId, checkpointNs, parentCheckpointId)
      const values = Object.values(this.writes[k] || {})
      const sends = values
        .filter(([_taskId, channel]) => channel === TASKS)
        .map(([_taskId, _channel, b64]) => this.serde.loadsTyped('json', fromB64(b64)))
      pendingSends = await Promise.all(sends)
    }
    return pendingSends
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    await this.ensureLoaded()
    const threadId = config.configurable?.thread_id as string | undefined
    const checkpointNs = (config.configurable?.checkpoint_ns as string | undefined) ?? ''
    let checkpointId = getCheckpointId(config)
    if (!threadId) return undefined
    if (checkpointId) {
      const saved = this.storage[threadId]?.[checkpointNs]?.[checkpointId]
      if (saved) {
        const [checkpointB64, metadataB64, parentCheckpointId] = saved
        const pendingSends = await this.getPendingSends(threadId, checkpointNs, parentCheckpointId)
        const deserializedCheckpoint = {
          ...(await this.serde.loadsTyped('json', fromB64(checkpointB64))),
          pending_sends: pendingSends
        } as Checkpoint
        const outer = key(threadId, checkpointNs, checkpointId)
        const pendingWrites = await Promise.all(
          Object.values(this.writes[outer] || {}).map(async ([taskId, channel, valueB64]) => {
            return [taskId, channel, await this.serde.loadsTyped('json', fromB64(valueB64))] as any
          })
        )
        const tuple: CheckpointTuple = {
          config,
          checkpoint: deserializedCheckpoint,
          metadata: await this.serde.loadsTyped('json', fromB64(metadataB64)),
          pendingWrites
        }
        if (parentCheckpointId !== undefined) {
          tuple.parentConfig = { configurable: { thread_id: threadId, checkpoint_ns: checkpointNs, checkpoint_id: parentCheckpointId } }
        }
        return tuple
      }
    } else {
      const checkpoints = this.storage[threadId]?.[checkpointNs]
      if (checkpoints) {
        const latest = Object.keys(checkpoints).sort((a, b) => b.localeCompare(a))[0]
        if (!latest) return undefined
        checkpointId = latest
        const saved = checkpoints[latest]
        if (!saved) return undefined
        const [checkpointB64, metadataB64, parentCheckpointId] = saved
        const pendingSends = await this.getPendingSends(threadId, checkpointNs, parentCheckpointId)
        const deserializedCheckpoint = {
          ...(await this.serde.loadsTyped('json', fromB64(checkpointB64))),
          pending_sends: pendingSends
        } as Checkpoint
        const outer = key(threadId, checkpointNs, checkpointId)
        const pendingWrites = await Promise.all(
          Object.values(this.writes[outer] || {}).map(async ([taskId, channel, valueB64]) => {
            return [taskId, channel, await this.serde.loadsTyped('json', fromB64(valueB64))] as any
          })
        )
        const tuple: CheckpointTuple = {
          config: { configurable: { thread_id: threadId, checkpoint_ns: checkpointNs, checkpoint_id: checkpointId } },
          checkpoint: deserializedCheckpoint,
          metadata: await this.serde.loadsTyped('json', fromB64(metadataB64)),
          pendingWrites
        }
        if (parentCheckpointId !== undefined) {
          tuple.parentConfig = { configurable: { thread_id: threadId, checkpoint_ns: checkpointNs, checkpoint_id: parentCheckpointId } }
        }
        return tuple
      }
    }
    return undefined
  }

  async *list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    await this.ensureLoaded()
    const { before, filter } = options ?? {}
    let limit = options?.limit
    const configThreadId = config.configurable?.thread_id as string | undefined
    const threadIds = configThreadId ? [configThreadId] : Object.keys(this.storage)
    const configCheckpointNamespace = config.configurable?.checkpoint_ns as string | undefined
    const configCheckpointId = config.configurable?.checkpoint_id as string | undefined
    for (const threadId of threadIds) {
      for (const checkpointNamespace of Object.keys(this.storage[threadId] ?? {})) {
        if (configCheckpointNamespace !== undefined && checkpointNamespace !== configCheckpointNamespace) continue
        const checkpoints = this.storage[threadId]?.[checkpointNamespace] ?? {}
        const sorted = Object.entries(checkpoints).sort((a, b) => b[0].localeCompare(a[0]))
        for (const [checkpointId, [checkpointB64, metadataB64, parentCheckpointId]] of sorted) {
          if (configCheckpointId && checkpointId !== configCheckpointId) continue
          if (before?.configurable?.checkpoint_id && checkpointId >= (before.configurable.checkpoint_id as string)) continue
          const metadata = await this.serde.loadsTyped('json', fromB64(metadataB64))
          if (filter && !Object.entries(filter).every(([k, v]) => (metadata as any)[k] === v)) continue
          if (limit !== undefined) {
            if (limit <= 0) break
            limit -= 1
          }
          const outer = key(threadId, checkpointNamespace, checkpointId)
          const pendingSends = await this.getPendingSends(threadId, checkpointNamespace, parentCheckpointId)
          const pendingWrites = await Promise.all(
            Object.values(this.writes[outer] || {}).map(async ([taskId, channel, valueB64]) => {
              return [taskId, channel, await this.serde.loadsTyped('json', fromB64(valueB64))] as any
            })
          )
          const deserializedCheckpoint = {
            ...(await this.serde.loadsTyped('json', fromB64(checkpointB64))),
            pending_sends: pendingSends
          } as Checkpoint
          const tuple: CheckpointTuple = {
            config: { configurable: { thread_id: threadId, checkpoint_ns: checkpointNamespace, checkpoint_id: checkpointId } },
            checkpoint: deserializedCheckpoint,
            metadata,
            pendingWrites
          }
          if (parentCheckpointId !== undefined) {
            tuple.parentConfig = { configurable: { thread_id: threadId, checkpoint_ns: checkpointNamespace, checkpoint_id: parentCheckpointId } }
          }
          yield tuple
        }
      }
    }
  }

  async put(config: RunnableConfig, checkpoint: Checkpoint, metadata: any): Promise<RunnableConfig> {
    await this.ensureLoaded()
    const prepared = copyCheckpoint(checkpoint)
    delete (prepared as any).pending_sends
    const threadId = config.configurable?.thread_id as string | undefined
    const checkpointNamespace = (config.configurable?.checkpoint_ns as string | undefined) ?? ''
    if (!threadId) {
      throw new Error('Missing thread_id')
    }
    this.storage[threadId] ||= {}
    this.storage[threadId][checkpointNamespace] ||= {}
    const [, serializedCheckpoint] = this.serde.dumpsTyped(prepared)
    const [, serializedMetadata] = this.serde.dumpsTyped(metadata)
    this.storage[threadId][checkpointNamespace][checkpoint.id] = [
      toB64(serializedCheckpoint),
      toB64(serializedMetadata),
      config.configurable?.checkpoint_id as string | undefined
    ]
    await this.enqueueFlush()
    return { configurable: { thread_id: threadId, checkpoint_ns: checkpointNamespace, checkpoint_id: checkpoint.id } }
  }

  async putWrites(config: RunnableConfig, writes: any[], taskId: string): Promise<void> {
    await this.ensureLoaded()
    const threadId = config.configurable?.thread_id as string | undefined
    const checkpointNamespace = (config.configurable?.checkpoint_ns as string | undefined) ?? ''
    const checkpointId = config.configurable?.checkpoint_id as string | undefined
    if (!threadId) throw new Error('Missing thread_id')
    if (!checkpointId) throw new Error('Missing checkpoint_id')
    const outer = key(threadId, checkpointNamespace, checkpointId)
    const outerWrites = this.writes[outer]
    const bucket = (this.writes[outer] ||= {})
    writes.forEach(([channel, value]: any, idx: number) => {
      const [, serializedValue] = this.serde.dumpsTyped(value)
      const innerKey = [taskId, (WRITES_IDX_MAP as any)[channel] || idx]
      const innerKeyStr = `${innerKey[0]},${innerKey[1]}`
      if (innerKey[1] >= 0 && outerWrites && innerKeyStr in outerWrites) return
      bucket[innerKeyStr] = [taskId, channel, toB64(serializedValue)]
    })
    await this.enqueueFlush()
  }
}
