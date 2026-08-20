/**
 * 共享图片槽：mc_see（截图工具）写入画面，决策层（mc-loop / mc-session）
 * 在下一次心跳时取走并嵌入多模态消息，让 LLM 真正「看见」。
 *
 * 支持多图（环顾四周模式一次写 4 张，按 前/右/后/左 顺序）；
 * 槽位按穿越者用户名分仓（2026-08-20：单进程多 agent 形态下共享单槽
 * 会把桐人的画面喂给鸣人——身体写哪仓、心跳取哪仓，互不串门）。
 * 图片消费即清空，附带时效防止陈图误入。
 * file 字段：截图落盘的相对路径（<username>/<name>.jpg），供观察面板展示；
 * 为 null 表示该图没有落盘副本（如 playwright 兜底路径）。
 */
export interface CapturedImage {
  dataUrl: string
  file: string | null
  label?: string // 方向标签（「前方」等），多图时随图喂给 VLM
}

interface Slot {
  images: CapturedImage[]
  at: number
}

/** 旧 API 兼容仓（无用户名时的缺省仓）。 */
const DEFAULT_SLOT = '_default'
const slots = new Map<string, Slot>()

const slotOf = (key: string): Slot => {
  let s = slots.get(key)
  if (!s) {
    s = { images: [], at: 0 }
    slots.set(key, s)
  }
  return s
}

/** 写入单张截图（按穿越者用户名分仓；兼容旧调用=缺省仓）。 */
export function setLastImage(dataUrl: string, file: string | null = null, username?: string): void {
  const s = slotOf(username ?? DEFAULT_SLOT)
  s.images = [{ dataUrl, file }]
  s.at = Date.now()
}

/** 写入多张截图（环顾四周；按穿越者用户名分仓）。 */
export function setLastImages(images: CapturedImage[], username?: string): void {
  if (images.length === 0) return
  const s = slotOf(username ?? DEFAULT_SLOT)
  s.images = images
  s.at = Date.now()
}

/** 取走该穿越者最近的截图（超过 maxAgeMs 的旧图作废），取后即清。
 * maxImages: 端点单次 prompt 图片上限——vLLM/Qwen-VL 为 2（2026-08-19 Sasuke #353
 * 实锤 LLM 400 "At most 2 image(s)"）。环顾四周存 3+ 角度时只带最新 2 张。 */
export function takeLastImages(maxAgeMs = 60_000, maxImages = 2, username?: string): CapturedImage[] {
  const key = username ?? DEFAULT_SLOT
  const s = slots.get(key)
  if (!s) return []
  const imgs = s.images
  s.images = []
  return Date.now() - s.at <= maxAgeMs ? imgs.slice(-maxImages) : []
}
