import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import mineflayer from 'mineflayer'
import type { Bot } from 'mineflayer'
import pf from 'mineflayer-pathfinder'
import { plugin as toolPlugin } from 'mineflayer-tool'
import { tunedMovements } from './mc-tools'

export const name = 'mc-bot-service'

export interface Config {
  host: string
  port: number
  username: string
  autoReconnect: boolean
  viewerEnabled: boolean
  viewerPort: number
  viewerFirstPerson: boolean
}

export const Config: Schema<Config> = Schema.object({
  host: Schema.string().default('localhost'),
  port: Schema.number().default(25565),
  username: Schema.string().default('HarnessBot'),
  autoReconnect: Schema.boolean().default(true),
  viewerEnabled: Schema.boolean().default(true),
  viewerPort: Schema.number().default(3001),
  viewerFirstPerson: Schema.boolean().default(false),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcbot: Bot
  }
}

type Handler = (...args: any[]) => void

/** 门面类型别名（历史叫 McBotService，即 mcbot 门面 Proxy）。 */
export type McBotService = Bot

/** 一个穿越者 bot 连接的生命周期句柄：门面 + 断开。 */
export interface BotService {
  facade: Bot
  dispose(): void
}

/**
 * 创建一个独立 bot 连接（不依赖 cordis ctx）。
 *
 * 返回一个稳定「门面」：属性访问动态转发到当前 mineflayer 实例；
 * on/once/off 注册进持久表，每次重连后新实例上线时全量重挂——事件监听
 * 跨重连存活。调用方负责把 facade provide 进 scope，并在 scope 销毁时
 * 调用 dispose() 断开 bot。
 */
export function createBotService(config: Config): BotService {
  const log = (msg: string) => console.log(`[mc-bot-service] ${msg}`)
  let disposed = false
  let currentBot: Bot | null = null
  let closeViewer: (() => void) | null = null

  // ------------------------------------------------------------------
  // 稳定门面（2026-08-18 修复：僵尸实例 bug）
  //
  // 旧实现每次重连 ctx.set('mcbot', 新实例)，但所有插件在 apply 时
  // `const bot = ctx.mcbot` 一次性捕获引用——重连一次后工具层/事件层
  // 全部攥着死实例（docker 下 bot 与服务器并发启动，首连必失败，
  // bug 从偶发变成必现）。
  //
  // 现在只 provide 一次"门面"：属性访问动态转发到 currentBot；
  // on/once/off 注册进持久表，每个新实例上线时全量重挂——事件监听
  // 跨重连存活。所有插件无需任何改动即痊愈。
  // ------------------------------------------------------------------
  const persistentListeners = new Map<string, Set<Handler>>()

  function persistAdd(event: string, handler: Handler): void {
    let set = persistentListeners.get(event)
    if (!set) {
      set = new Set()
      persistentListeners.set(event, set)
    }
    set.add(handler)
  }

  function persistRemove(event: string, handler: Handler): void {
    persistentListeners.get(event)?.delete(handler)
  }

  function attachAll(bot: Bot): void {
    for (const [event, set] of persistentListeners) {
      for (const handler of set) bot.on(event, handler)
    }
    if (persistentListeners.size > 0) {
      log(`bridged ${persistentListeners.size} persistent event(s) to new bot instance`)
    }
  }

  const facade: Bot = new Proxy({} as Bot, {
    get(_target, prop) {
      // 事件 API：登记进持久表并挂到当前实例
      if (prop === 'on') {
        return (event: string, handler: Handler) => {
          persistAdd(event, handler)
          if (currentBot) currentBot.on(event, handler)
          return facade
        }
      }
      if (prop === 'once') {
        return (event: string, handler: Handler) => {
          const wrapped: Handler = (...args: any[]) => {
            persistRemove(event, wrapped)
            handler(...args)
          }
          persistAdd(event, wrapped)
          if (currentBot) currentBot.on(event, wrapped)
          return facade
        }
      }
      if (prop === 'off' || prop === 'removeListener') {
        return (event: string, handler: Handler) => {
          persistRemove(event, handler)
          if (currentBot) currentBot.removeListener(event, handler)
          return facade
        }
      }
      if (prop === 'removeAllListeners') {
        return (event?: string) => {
          if (event) persistentListeners.delete(event)
          else persistentListeners.clear()
          if (currentBot) currentBot.removeAllListeners(event)
          return facade
        }
      }
      if (!currentBot) {
        throw new Error('bot not connected (yet)')
      }
      const value = Reflect.get(currentBot, prop, currentBot)
      return typeof value === 'function' ? (value as (...a: any[]) => any).bind(currentBot) : value
    },
    set(_target, prop, value) {
      if (!currentBot) return false
      return Reflect.set(currentBot, prop, value, currentBot)
    },
    has(_target, prop) {
      return !!currentBot && Reflect.has(currentBot, prop)
    },
  })

  function connect(): void {
    log(`connecting to ${config.host}:${config.port} as "${config.username}"`)
    const bot = mineflayer.createBot({
      host: config.host,
      port: config.port,
      username: config.username,
      checkTimeoutInterval: 30_000,
    })
    currentBot = bot

    // 官方插件 + 把持久事件监听桥接到新实例
    bot.loadPlugin(pf.pathfinder)
    bot.loadPlugin(toolPlugin)
    attachAll(bot)

    bot.once('spawn', async () => {
      const p = bot.entity?.position
      log(`spawned at ${p ? `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})` : 'unknown'}`)
      bot.pathfinder.setMovements(tunedMovements(bot))

      // 双视角 viewer（prismarine-viewer），供观察面板 iframe 嵌入：
      //   viewerPort     = 第三人称（环绕跟随，默认 3001）
      //   viewerPort+100 = 第一人称（bot 眼中世界）
      // 两个实例的 close 句柄分别保存；重连时先全部关闭再重建。
      // viewer 懒加载：不用 viewer（MC_VIEWER=0）的部署完全不需要装
      // node-canvas-webgl/canvas/gl 这些 native 依赖（很多平台编译不过）。
      // ⚠️ 必须变量化 import 路径：esbuild 会把字面量 `import('prismarine-viewer')`
      // 提升成顶层静态 import，导致 viewerEnabled=false 时加载即崩。
      if (config.viewerEnabled) {
        try {
          if (closeViewer) {
            closeViewer()
            closeViewer = null
          }
          const pvModule = 'prismarine-viewer'
          const pv = await import(pvModule)
          const prismarineViewer = (pv as any).default
          const mineflayerViewer = prismarineViewer.mineflayer
          mineflayerViewer(bot, {
            port: config.viewerPort,
            firstPerson: false,
          })
          const closeThird = (bot as any).viewer.close.bind((bot as any).viewer)
          const closers: Array<() => void> = [closeThird]
          try {
            mineflayerViewer(bot, {
              port: config.viewerPort + 100,
              firstPerson: true,
            })
            closers.push((bot as any).viewer.close.bind((bot as any).viewer))
            log(`viewer ready: third @ :${config.viewerPort}, first @ :${config.viewerPort + 100}`)
          } catch (e) {
            // 第一人称端口失败不影响第三人称
            log(`first-person viewer start failed (ignored): ${(e as Error).message}`)
          }
          closeViewer = () => closers.forEach((c) => { try { c() } catch { /* already closed */ } })
        } catch (err) {
          log(`viewer start failed: ${(err as Error).message}`)
        }
      }
    })

    // 死亡自动复活（2026-08-18：Kirito 溺水后卡死亡屏，无人叫醒）
    bot.on('death', () => {
      log('died, auto-respawn in 2s')
      setTimeout(() => {
        if (disposed || currentBot !== bot) return
        try {
          bot.respawn()
        } catch (err) {
          log(`respawn failed: ${(err as Error).message}`)
        }
      }, 2000)
    })

    // 兜底：登录时玩家已处于死亡屏（不会发 death 事件），5s 无实体强制复活
    bot.on('login', () => {
      setTimeout(() => {
        if (disposed || currentBot !== bot) return
        if (!bot.entity) {
          log('no entity 5s after login (dead at login?), forcing respawn')
          try {
            bot.respawn()
          } catch (err) {
            log(`force respawn failed: ${(err as Error).message}`)
          }
        }
      }, 5000)
    })

    bot.on('error', (err: Error) => {
      log(`bot error: ${err.message}`)
    })

    bot.on('end', (reason: string) => {
      log(`bot disconnected: ${reason}`)
      if (!disposed && config.autoReconnect) {
        setTimeout(() => {
          if (disposed) return
          connect()
        }, 3000)
      }
    })
  }

  connect()

  return {
    facade,
    dispose() {
      disposed = true
      log('disposing, ending bot')
      if (closeViewer) {
        closeViewer()
        closeViewer = null
      }
      if (currentBot) {
        currentBot.end('service disposed')
        currentBot = null
      }
    },
  }
}

/**
 * 世界侧（Goddess spectator）仍走顶层单例：provide 一个门面，scope 销毁时
 * 断开 bot。穿越者侧不再走 apply，而是由 mc-session 在每个 agent 的 setup 里
 * 调用 createBotService 建立独立 bot 并 provide 到 agent scope。
 */
export function apply(ctx: Context, config: Config) {
  const service = createBotService(config)
  ctx.provide('mcbot', service.facade)
  ctx.effect(() => service.dispose)
}
