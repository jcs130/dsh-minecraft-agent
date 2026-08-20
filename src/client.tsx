/**
 * dsh-minecraft-agent 客户端插件（browser 半）。
 *
 * 在官方 dsh web 的侧边栏底部 `sidebar.footer.action` 槽位注册一个
 * 「MC 面板」按钮：rail 态显示紧凑图标，wide 态显示文字。点击后弹出一个
 * `position: fixed` 浮动面板，内嵌同源 `<iframe src="/mc-panel/">`，
 * 复用 server 端 mc-panel 插件已渲染的完整 dashboard —— 零重写。
 *
 * 官方 recipe 参照：ui-settings-general 的 `sidebar.settings` 触发按钮 +
 * 浮动面板（chrome.tsx 的 TriggerContent / SettingsRoot 的 fixed 面板），
 * 以及 ui-settings-general apply() 里 `ctx.slots.inject(slot, register)`
 * 等声明就绪再注册的范式（激活顺序不受约束）。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// type-only：把 `sidebar.footer.action` 的 SlotMap 声明（ui-sidebar）拉进本
// 程序，让 `ctx.slots.register` 的类型检查认得出合法 slot 名。
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { useState } from 'react'

/** footer action 依赖：只需要 slots 服务（注册 + 等 slot 声明）。 */
export const inject = ['slots']

/** footer action 组件：宽窄两态按钮 + 点击开合的浮动 iframe 面板。 */
function McPanelAction({ wide }: { wide: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        title="MC 控制面板"
        aria-label="MC 控制面板"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: wide ? '6px 10px' : '6px',
          border: '1px solid rgba(128,128,128,.35)',
          borderRadius: 6,
          background: 'transparent',
          color: 'inherit',
          cursor: 'pointer',
          fontSize: wide ? 13 : 11,
          lineHeight: 1,
        }}
      >
        {wide ? '🕹 MC 面板' : '🕹'}
      </button>
      {open ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            display: 'flex',
            flexDirection: 'column',
            background: '#17191d',
            color: '#e6e8eb',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 14px',
              borderBottom: '1px solid rgba(128,128,128,.25)',
              flex: 'none',
            }}
          >
            <span style={{ fontWeight: 600 }}>MC 控制面板</span>
            <button
              type="button"
              aria-label="关闭"
              onClick={() => setOpen(false)}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
                fontSize: 20,
                lineHeight: 1,
                padding: '2px 8px',
              }}
            >
              ×
            </button>
          </div>
          <iframe
            src="/mc-panel/"
            title="MC 控制面板"
            style={{ flex: 1, width: '100%', border: 'none', display: 'block' }}
          />
        </div>
      ) : null}
    </>
  )
}

/**
 * 注册 footer action。`ctx.slots.inject` 等待 ui-sidebar 声明
 * `sidebar.footer.action`（声明就绪才执行 callback），再 register 进 list 槽位。
 * list 槽位铁律：必须带 `id`（SlotCore 对缺失 id 的 list 注册抛错）。
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register(
      {
        name: 'sidebar.footer.action',
        id: 'mc-panel',
        order: 100,
      },
      McPanelAction,
    ),
  )
}
