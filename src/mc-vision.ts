/**
 * 共享图片槽：mc_see（截图工具）写入画面，mc-loop 在下一次
 * 决策时取走并嵌入多模态 user 消息，让 LLM 真正「看见」。
 *
 * 支持多图（环顾四周模式一次写 4 张，按 前/右/后/左 顺序）；
 * 单进程内单例；图片消费即清空，附带时效防止陈图误入。
 * file 字段：截图落盘的相对路径（<username>/<name>.jpg），供观察面板展示；
 * 为 null 表示该图没有落盘副本（如 playwright 兜底路径）。
 */
export interface CapturedImage {
  dataUrl: string
  file: string | null
  label?: string // 方向标签（「前方」等），多图时随图喂给 VLM
}

let lastImages: CapturedImage[] = []
let lastImagesAt = 0

/** 写入单张截图（兼容旧调用）。 */
export function setLastImage(dataUrl: string, file: string | null = null): void {
  lastImages = [{ dataUrl, file }]
  lastImagesAt = Date.now()
}

/** 写入多张截图（环顾四周）。 */
export function setLastImages(images: CapturedImage[]): void {
  if (images.length === 0) return
  lastImages = images
  lastImagesAt = Date.now()
}

/** 取走最近的截图（超过 maxAgeMs 的旧图作废），取后即清。
 * maxImages: 端点单次 prompt 图片上限——vLLM/Qwen-VL 为 2（2026-08-19 Sasuke #353
 * 实锤 LLM 400 "At most 2 image(s)"）。环顾四周存 3+ 角度时只带最新 2 张。 */
export function takeLastImages(maxAgeMs = 60_000, maxImages = 2): CapturedImage[] {
  const imgs = lastImages
  lastImages = []
  return Date.now() - lastImagesAt <= maxAgeMs ? imgs.slice(-maxImages) : []
}
