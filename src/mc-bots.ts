/**
 * mc-bots —— 多穿越者「身体注册表」共享类型与查询助手（纯模块，非插件）。
 *
 * 背景（2026-08-20，A 方案：单 dsh web 进程多 agent）：一个进程里多个
 * 穿越者 agent 各自一具身体（mineflayer 连接）。身体归属不走 cordis
 * isolate 符号表手术（agent ctx 是 dsh 内部 ctx.extend 铸造，外部无法在
 * 其祖先链插入 isolate 表），而是 mc-session 在 root provide 一个注册表
 * 服务 `mcbots`，消费方按 exec.agent.id（= SessionId，如 mc-Naruto-0820）
 * 直查自己的身体——确定性、可调试、零 cordis 魔法。
 *
 * 查询助手三条：
 *  - registryBots(ctx)：读 mcbots 注册表（无则空数组）
 *  - allBots(ctx)：全部身体门面（多模式遍历用；单模式回落 mcbot 单例）
 *  - botFor(ctx, exec)：工具执行期解析「当前 agent 的身体」——
 *    sessionId 精确匹配 → sessionId 前缀剥 mc- 后按 username 匹配 →
 *    exec.agent.ctx.mcbot → ctx.mcbot 兜底。
 */
import type { Bot } from 'mineflayer'

/** 注册表条目：username + 该穿越者名下全部 sessionId + 身体门面。 */
export interface McBotEntry {
  username: string
  sessionIds: string[]
  facade: Bot
}

export function registryBots(ctx: unknown): McBotEntry[] {
  try {
    const c = ctx as { get?: (n: string) => unknown }
    const reg = c.get?.('mcbots')
    return Array.isArray(reg) ? (reg as McBotEntry[]) : []
  } catch {
    return []
  }
}

/** 全部身体门面。多模式返回注册表全部；单模式/注册表为空回落 mcbot 单例。 */
export function allBots(ctx: unknown): Bot[] {
  const reg = registryBots(ctx)
  if (reg.length) return reg.map((e) => e.facade)
  try {
    const c = ctx as { mcbot?: Bot }
    const b = c.mcbot
    return b ? [b] : []
  } catch {
    return []
  }
}

/** 工具执行期解析当前 agent 的身体。 */
export function botFor(ctx: unknown, exec: any): Bot | undefined {
  const reg = registryBots(ctx)
  if (reg.length) {
    const sid = exec?.agent?.id != null ? String(exec.agent.id) : ''
    if (sid) {
      const bySid = reg.find((e) => e.sessionIds.includes(sid))
      if (bySid) return bySid.facade
      // sessionId 形如 mc-Naruto-0820 / mc-Kirito：剥前缀取首段按用户名匹配
      const parsed = sid.replace(/^mc[-_]/i, '').split(/[-_]/)[0]?.toLowerCase()
      if (parsed) {
        const byName = reg.find((e) => e.username.toLowerCase() === parsed)
        if (byName) return byName.facade
      }
    }
  }
  try {
    const b = exec?.agent?.ctx?.mcbot
    if (b) return b as Bot
  } catch { /* agent ctx 无 mcbot inject —— 走进程单例 fallback */ }
  try {
    return (ctx as { mcbot?: Bot }).mcbot
  } catch {
    return undefined
  }
}
