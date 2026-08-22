import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/**
 * mc-transmigrator —— 穿越者档案服务。
 *
 * 每个「穿越者」= 人格层（backstory 前世 + persona 注入 mc-loop 的人格）
 * 与技能层（innate 初始技能偏好，走 MC 魔法系统）彻底解耦。IP 人物只带
 * 思考方式/行为风格/性格口吻/价值观，原作技能不带入 MC。
 *
 * 档案索引在 data/transmigrators.json；backstory / persona 正文放独立
 * .md 文件（相对索引所在目录解析），便于人工润色，符合「灵魂三件套」惯例。
 */
export const name = 'mc-transmigrator'
export const inject: string[] = []

export interface Config {
  registryPath: string
}

export const Config: Schema<Config> = Schema.object({
  registryPath: Schema.string().default('./data/transmigrators.json'),
})

export interface InnatePreference {
  preferredAtoms: string[]
  reasoning: string
}

/** 运行时创建穿越者档案的输入（login skill / 聊天式角色创建用）。 */
export interface CreateTransmigratorInput {
  /** MC 用户名（mineflayer 登录名，必填，如 Edward）。 */
  username: string
  /** 角色人名（session 显示名，如「爱德华」）。缺省回落 username。 */
  name?: string
  /** 来源类型：现成 IP 人物 / 随机生成前世。缺省 'random'。 */
  origin?: 'ip' | 'random'
  /** IP 来源（origin='ip' 时的作品名）。 */
  source?: string | null
  /** 称号（如「国家炼金术师 · 钢」）。 */
  epithet?: string
  /** 前世故事正文（写入 transmigrators/<username>.backstory.md）。 */
  backstory?: string
  /** 人格正文（写入 transmigrators/<username>.persona.md）。 */
  persona?: string
  /** 初始技能偏好（降临仪式自选技能排序）。 */
  innate?: InnatePreference
}

export interface Transmigrator {
  id: string
  name: string
  username: string
  origin: 'ip' | 'random'
  source: string | null
  epithet: string
  backstory: string
  persona: string
  innate: InnatePreference
}

/** 档案索引文件里的原始条目（backstory/persona 是文件引用，加载时读入）。 */
interface RawEntry {
  id: string
  name?: string
  username: string
  origin?: 'ip' | 'random'
  source?: string | null
  epithet?: string
  backstoryFile?: string
  personaFile?: string
  innate?: InnatePreference
}

export class TransmigratorRegistry {
  private readonly path: string
  private readonly base: string
  private items: Transmigrator[]
  private readonly byUsername: Map<string, Transmigrator>

  constructor(registryPath: string) {
    this.path = resolve(registryPath)
    this.base = dirname(this.path)
    const entries = this.loadEntries(this.path)
    this.items = entries.map((e) => this.materialize(this.base, e))
    this.byUsername = new Map(this.items.map((t) => [t.username.toLowerCase(), t]))
  }

  private loadEntries(path: string): RawEntry[] {
    try {
      if (existsSync(path)) {
        const raw = JSON.parse(readFileSync(path, 'utf-8'))
        const list = Array.isArray(raw) ? raw : raw?.transmigrators
        if (Array.isArray(list)) {
          return list.filter(
            (e): e is RawEntry =>
              !!e && typeof e.id === 'string' && typeof e.username === 'string',
          )
        }
      }
    } catch (err) {
      console.error(
        `[mc-transmigrator] failed to load registry: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    return []
  }

  private readText(base: string, rel: string | undefined, fallback: string): string {
    if (!rel) return fallback
    try {
      const p = resolve(base, rel)
      if (existsSync(p)) return readFileSync(p, 'utf-8').trim()
    } catch {
      /* ignore */
    }
    return fallback
  }

  private materialize(base: string, e: RawEntry): Transmigrator {
    return {
      id: e.id,
      name: e.name || e.username,
      username: e.username,
      origin: e.origin === 'random' ? 'random' : 'ip',
      source: e.source ?? null,
      epithet: e.epithet ?? '',
      backstory: this.readText(base, e.backstoryFile, ''),
      persona: this.readText(base, e.personaFile, ''),
      innate: e.innate ?? { preferredAtoms: [], reasoning: '' },
    }
  }

  getByUsername(username: string): Transmigrator | null {
    if (!username) return null
    return this.byUsername.get(username.toLowerCase()) ?? null
  }

  list(): Transmigrator[] {
    return this.items
  }

  /**
   * 运行时创建/更新一个穿越者档案（login skill 的落盘步骤）。
   *
   * 写入两处：正文（backstory/persona）落 transmigrators/<id>.*.md，索引条目
   * 追加进 registry JSON（保留 _comment 与 transmigrators 包装结构）。写盘后
   * 同步刷新内存（items + byUsername），后续 getByUsername/list 立即可见。
   *
   * 同名（username 小写）已存在时按 upsert 语义覆盖，避免重复档案。
   */
  create(input: CreateTransmigratorInput): Transmigrator {
    const username = input.username.trim()
    if (!username) throw new Error('[mc-transmigrator] create: username is required')
    const id = username.toLowerCase()
    const backstoryFile = `transmigrators/${id}.backstory.md`
    const personaFile = `transmigrators/${id}.persona.md`
    const entry: RawEntry = {
      id,
      username,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.origin !== undefined ? { origin: input.origin } : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.epithet !== undefined ? { epithet: input.epithet } : {}),
      backstoryFile,
      personaFile,
      ...(input.innate !== undefined ? { innate: input.innate } : {}),
    }
    // 正文落盘（只有提供了正文才写文件，缺省时 readText 回落空串）。
    if (input.backstory !== undefined || input.persona !== undefined) {
      try {
        mkdirSync(resolve(this.base, 'transmigrators'), { recursive: true })
      } catch { /* 目录已存在 */ }
      if (input.backstory !== undefined) {
        writeFileSync(resolve(this.base, backstoryFile), input.backstory, 'utf-8')
      }
      if (input.persona !== undefined) {
        writeFileSync(resolve(this.base, personaFile), input.persona, 'utf-8')
      }
    }
    this.persist(entry)
    const tm = this.materialize(this.base, entry)
    const idx = this.items.findIndex((t) => t.username.toLowerCase() === id)
    if (idx >= 0) this.items[idx] = tm
    else this.items.push(tm)
    this.byUsername.set(id, tm)
    return tm
  }

  /** 读原始 JSON（保留 _comment / transmigrators 包装），upsert 后写回。 */
  private persist(entry: RawEntry): void {
    let root: unknown = { transmigrators: [] }
    try {
      if (existsSync(this.path)) {
        root = JSON.parse(readFileSync(this.path, 'utf-8'))
      }
    } catch {
      root = { transmigrators: [] }
    }
    const wrapped = !Array.isArray(root)
    const list: RawEntry[] = (Array.isArray(root) ? root : (root as { transmigrators?: RawEntry[] }).transmigrators) ?? []
    const idx = list.findIndex((e) => e.id === entry.id)
    if (idx >= 0) list[idx] = entry
    else list.push(entry)
    const next = wrapped ? { ...(root as object), transmigrators: list } : list
    writeFileSync(this.path, JSON.stringify(next, null, 2), 'utf-8')
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcTransmigrators: TransmigratorRegistry
  }
}

export function apply(ctx: Context, config: Config) {
  const registry = new TransmigratorRegistry(config.registryPath)
  ctx.provide('mcTransmigrators', registry)
  const names = registry.list().map((t) => `${t.name}(${t.username})`).join(', ') || '(none)'
  console.log(`[mc-transmigrator] loaded ${registry.list().length} transmigrator(s): ${names}`)
}
