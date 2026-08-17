import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export const name = 'mc-memory'
export const inject: string[] = []

export interface Config {
  memoryPath: string
  maxPointsPerType: number
}

export const Config: Schema<Config> = Schema.object({
  memoryPath: Schema.string().default('./data/mc-memory.json'),
  maxPointsPerType: Schema.number().default(20),
})

export interface Vec3Like {
  x: number
  y: number
  z: number
}

export interface MemoryState {
  version: 1
  base: Vec3Like | null
  publicChest: Vec3Like | null
  resourcePoints: Record<string, Vec3Like[]>
  currentGoal: string | null
}

function emptyState(): MemoryState {
  return { version: 1, base: null, publicChest: null, resourcePoints: {}, currentGoal: null }
}

function round(pos: { x: number; y: number; z: number }): Vec3Like {
  return { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) }
}

function samePoint(a: Vec3Like, b: Vec3Like): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z
}

/**
 * Durable, cross-restart memory for the MC agent. This is the "village elder"
 * layer distilled to its essence: the agent remembers the base, the public
 * chest, and the coordinates of resource blocks it has discovered, so its
 * decisions carry long-term context instead of restarting from zero every
 * time the loop runs.
 */
export class MemoryStore {
  private state: MemoryState
  private readonly path: string
  private readonly maxPoints: number

  constructor(path: string, maxPointsPerType: number) {
    this.path = resolve(path)
    this.maxPoints = Math.max(1, Math.floor(maxPointsPerType))
    this.state = this.load()
  }

  private load(): MemoryState {
    try {
      if (existsSync(this.path)) {
        const raw = JSON.parse(readFileSync(this.path, 'utf-8'))
        if (raw && typeof raw === 'object' && raw.version === 1) {
          return this.normalize(raw)
        }
      }
    } catch (err) {
      console.error(
        `[mc-memory] failed to load memory, starting fresh: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    return emptyState()
  }

  private normalize(raw: Record<string, unknown>): MemoryState {
    const s = emptyState()
    const base = raw.base as { x?: number; y?: number; z?: number } | null | undefined
    if (base && typeof base.x === 'number' && typeof base.y === 'number' && typeof base.z === 'number') {
      s.base = round(base as Vec3Like)
    }
    const chest = raw.publicChest as { x?: number; y?: number; z?: number } | null | undefined
    if (chest && typeof chest.x === 'number' && typeof chest.y === 'number' && typeof chest.z === 'number') {
      s.publicChest = round(chest as Vec3Like)
    }
    const goal = raw.currentGoal
    if (typeof goal === 'string' && goal.trim()) s.currentGoal = goal
    const points = raw.resourcePoints as Record<string, unknown> | null | undefined
    if (points && typeof points === 'object') {
      for (const [type, list] of Object.entries(points)) {
        if (!Array.isArray(list)) continue
        s.resourcePoints[type] = list
          .filter(
            (p): p is Vec3Like =>
              !!p && typeof p.x === 'number' && typeof p.y === 'number' && typeof p.z === 'number',
          )
          .map((p) => round(p))
      }
    }
    return s
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const tmp = this.path + '.tmp'
      writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf-8')
      renameSync(tmp, this.path)
    } catch (err) {
      console.error(`[mc-memory] failed to save memory: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  getBase(): Vec3Like | null {
    return this.state.base
  }

  setBase(pos: { x: number; y: number; z: number }): void {
    this.state.base = round(pos)
    this.save()
  }

  getPublicChest(): Vec3Like | null {
    return this.state.publicChest
  }

  setPublicChest(pos: { x: number; y: number; z: number }): void {
    this.state.publicChest = round(pos)
    this.save()
  }

  getCurrentGoal(): string | null {
    return this.state.currentGoal
  }

  setCurrentGoal(goal: string): void {
    if (!goal || !goal.trim()) return
    this.state.currentGoal = goal.trim()
    this.save()
  }

  /** Remember a resource block location. Returns true only when newly added. */
  rememberResource(type: string, pos: { x: number; y: number; z: number }): boolean {
    if (!type) return false
    const p = round(pos)
    const list = this.state.resourcePoints[type] ?? (this.state.resourcePoints[type] = [])
    if (list.some((q) => samePoint(q, p))) return false
    // Skip points within 2 blocks of an already-remembered one (avoid clutter).
    if (list.some((q) => Math.abs(q.x - p.x) <= 2 && Math.abs(q.y - p.y) <= 2 && Math.abs(q.z - p.z) <= 2)) {
      return false
    }
    list.push(p)
    if (list.length > this.maxPoints) list.splice(0, list.length - this.maxPoints)
    this.save()
    return true
  }

  getResourcePoints(type: string): Vec3Like[] {
    return this.state.resourcePoints[type] ?? []
  }

  /** Human + LLM readable summary of what the bot remembers. */
  summary(maxPerType = 5): string {
    const lines: string[] = []
    if (this.state.currentGoal) {
      lines.push(`current goal: ${this.state.currentGoal}`)
    }
    if (this.state.base) {
      lines.push(`base (home): (${this.state.base.x}, ${this.state.base.y}, ${this.state.base.z})`)
    }
    if (this.state.publicChest) {
      lines.push(
        `public chest: (${this.state.publicChest.x}, ${this.state.publicChest.y}, ${this.state.publicChest.z})`,
      )
    }
    const types = Object.keys(this.state.resourcePoints).filter((t) => this.state.resourcePoints[t].length > 0)
    if (types.length > 0) {
      lines.push('remembered resource points:')
      for (const type of types) {
        const all = this.state.resourcePoints[type]
        const shown = all.slice(-maxPerType)
        const pts = shown.map((p) => `(${p.x},${p.y},${p.z})`).join(', ')
        lines.push(`  ${type} (${all.length} known): ${pts}`)
      }
    }
    return lines.length > 0 ? lines.join('\n') : '(no memory yet)'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcMemory: MemoryStore
  }
}

export function apply(ctx: Context, config: Config) {
  const store = new MemoryStore(config.memoryPath, config.maxPointsPerType)
  ctx.provide('mcMemory', store)
  console.log(`[mc-memory] store ready at ${resolve(config.memoryPath)}`)
}
