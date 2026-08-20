/**
 * dsh-minecraft-agent 客户端插件（browser 半）。
 *
 * 在官方 dsh web 的会话视图环 `conversation.view` 槽位注册一个「MC面板」tab：
 * 与「对话」「轨迹」tab 并列同一行（header 的 tablist）。点击 tab 切换视图，
 * 视图内容渲染在会话 viewArea，内嵌同源 <iframe src="/mc-panel/">，复用
 * server 端 mc-panel 插件已渲染的完整 dashboard —— 零重写。
 *
 * 官方 recipe 参照：ui-trajectory 的 `conversation.view` 注册
 * （ctx.slots.inject + ctx.slots.register({ id, order, label }) + view 组件），
 * 以及 apply() 里 `ctx.slots.inject(slot, register)` 等声明就绪再注册的范式。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// type-only：把 `conversation.view` 的 SlotMap 声明（ui-conversation）拉进本
// 程序，让 `ctx.slots.register` 的类型检查认得出合法 slot 名。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** view 依赖：只需要 slots 服务（注册 + 等 slot 声明）。 */
export const inject = ['slots']

/**
 * MC 面板视图组件：渲染在会话 viewArea（官方 session body 以 only:<active id>
 * 逐个渲染 view ring），iframe 内嵌 server 端 dashboard 占满整区。
 * 无 store / inject face / locale 依赖，零 props 即可。
 */
function McPanelView() {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <iframe
        src="/mc-panel/"
        title="MC 控制面板"
        style={{ flex: 1, width: '100%', border: 'none', display: 'block' }}
      />
    </div>
  )
}

/**
 * 注册 conversation.view tab。`ctx.slots.inject` 等待 ui-conversation 声明
 * `conversation.view`（声明就绪才执行 callback），再 register 进 list 槽位。
 * list 槽位铁律：必须带 `id`。label 惰性求值 → ViewTab.label（tab 文案）。
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.view', () =>
    ctx.slots.register(
      {
        name: 'conversation.view',
        id: 'mc-panel',
        order: 100,
        label: () => 'MC面板',
      },
      McPanelView,
    ),
  )
}
