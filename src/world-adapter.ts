/**
 * WorldAdapter —— 智能体（my-agent-core）对「世界」的抽象操作面。
 *
 * 穿越者的自主循环（mc-loop）、咏唱（mc-mystic）、村庄感知（mc-village）等
 * 智能体能力只依赖本类型访问世界，不直接 import mineflayer——mineflayer 的
 * 类型依赖被收敛到这一个文件，作为「世界抽象」的单一入口。
 *
 * 当前唯一实现是 Minecraft（mineflayer 的 `Bot`），由 adapters/minecraft 的
 * mc-bot-service 门面（Proxy 动态转发到当前实例）在运行时提供。
 *
 * 演进方向：把这里的 type 别名逐步替换成真正的最小 interface（影子类型），
 * 使 my-agent-core 彻底摆脱 mineflayer 类型依赖——换游戏/环境时只需实现
 * 同一操作面，无需改动智能体基座。
 */
import type { Bot } from 'mineflayer'

export type WorldAdapter = Bot
