/**
 * mc-camera — 方案 C：进程内无头第一人称相机（node-canvas-webgl + three）。
 * 移植自 Mindcraft camera.js，适配本插件：
 *   - 懒初始化：首次截图时才建相机；bot 重连（实例更换/掉线）自动重建
 *   - capture() 返回 JPEG Buffer，同时落盘 data/screenshots/<username>/
 *   - 仅供 mc_see / mc-loop 使用；渲染按需触发，不常驻渲染循环
 */
import { mkdir, readdir, unlink } from 'node:fs/promises'
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { Worker } from 'node:worker_threads'
// default import：同 mc-tools.ts 的 CJS interop 说明
import Vec3 from 'vec3'
import type { Bot } from 'mineflayer'

// ⚠️ 3D 渲染栈（three / node-canvas-webgl / prismarine-viewer viewer）必须懒加载：
// node-canvas-webgl 与 canvas/gl 不在 package.json（Windows 裸机是从 Mindcraft
// node_modules robocopy 来的预编译；Docker 镜像自 2026-08-18 起内置 canvas/gl
// 预编译 + Xvfb，见 Dockerfile——headless-gl 的 GLX pbuffer 需要 X display）。
// 顶层静态 import 仍会连累「没装栈」的部署在模块加载期直接崩掉整个 bot 进程——
// 改成首次截图时动态加载，加载失败置 visionError，相机功能优雅降级
// （mc_see 回落 playwright 或报「不可用」）。
type Vision = {
  THREE: any
  createCanvas: any
  Viewer: any
  WorldView: any
}
let vision: Vision | null = null
let visionTried = false
let visionError = ''
async function loadVision(): Promise<Vision | null> {
  if (visionTried) return vision
  visionTried = true
  try {
    const [threeMod, canvasMod, viewerMod, worldViewMod] = await Promise.all([
      import('three'),
      import('node-canvas-webgl/lib/index.js'),
      import('prismarine-viewer/viewer/lib/viewer.js'),
      import('prismarine-viewer/viewer/lib/worldView.js'),
    ])
    const THREE = (threeMod as any).default ?? threeMod
    // prismarine-physics/viewer 的实体网格注册表没有 1.21.11 的新实体（text_display/
    // glow_squid/item…），getEntityMesh 直接 throw——updateEntity 事件路径没被
    // entities.update 的包装覆盖时仍会打断渲染/刷屏。在模块根上兜住：未知实体
    // 给一个隐形小方块网格，所有调用点一次治愈（CJS exports 可变，全进程生效）。
    const [entitiesMod] = await Promise.all([
      import('prismarine-viewer/viewer/lib/entities.js'),
    ])
    const entitiesRaw = (entitiesMod as any).default ?? entitiesMod
    const origGetEntityMesh = entitiesRaw.getEntityMesh
    if (typeof origGetEntityMesh === 'function') {
      entitiesRaw.getEntityMesh = (...fnArgs: unknown[]) => {
        try {
          return origGetEntityMesh(...fnArgs)
        } catch {
          const dummy = new THREE.Mesh(
            new THREE.BoxGeometry(0.25, 0.25, 0.25),
            new THREE.MeshBasicMaterial({ visible: false }),
          )
          return dummy
        }
      }
    }
    // 兜底：entities.js 内部对同模块 getEntityMesh 的闭包引用改不了（模块内
    // 解构绑定），它自己的 try/catch 会把「Unknown entity xxx」连栈打印刷屏但
    // 不致命——进程级过滤这一种噪音（console.log/error 都钩，message 匹配），
    // 其余输出原样放行。
    const isEntityNoise = (a: unknown[]): boolean => {
      const flat = a.map((x) => (x instanceof Error ? x.message : String(x))).join(' ')
      return /^(Error: )?Unknown entity /.test(flat)
    }
    for (const level of ['error', 'log'] as const) {
      const orig = console[level].bind(console)
      console[level] = (...a: unknown[]) => {
        if (isEntityNoise(a)) return
        orig(...a)
      }
    }
    // prismarine-viewer 的 WorldView 依赖浏览器 Worker API，node 下用 worker_threads 顶替
    // 其 viewer/lib 内部还有裸用全局 THREE / window 的浏览器假设，一并补上
    // @ts-expect-error -- global polyfill
    global.Worker = Worker
    ;(global as any).THREE = THREE
    vision = {
      THREE,
      createCanvas: (canvasMod as any).createCanvas,
      Viewer: (viewerMod as any).Viewer,
      WorldView: (worldViewMod as any).WorldView,
    }
    console.log('[mc-camera] vision stack loaded (three + node-canvas-webgl + prismarine-viewer)')
  } catch (err) {
    visionError = err instanceof Error ? err.message : String(err)
    console.warn(`[mc-camera] vision stack unavailable (headless deployment?) — mc_see degraded: ${visionError}`)
  }
  return vision
}

const WIDTH = 800
const HEIGHT = 512
// 竖直 FOV（three.js 语义）。800x512 (aspect 1.5625) 下水平视野 = 2*atan(tan(FOV/2)*1.5625)：
//   75 -> ~100°（原默认）；90 -> ~114°（宽视野）；再大会边缘畸变、远处物体过小，不利 VLM 识别
const FOV = Number(process.env.MC_EYES_FOV || 90)
// 视距（chunk）。无头渲染没有客户端开销，加大只影响首轮网格化时长与内存
const VIEW_DISTANCE = Number(process.env.MC_EYES_VIEW || 10)
const KEEP_SHOTS = 40

export interface Shot {
  buffer: Buffer
  file: string | null // 相对 shots 根的路径（成功落盘时），供面板引用
}

interface CameraState {
  bot: Bot
  renderer: any
  canvas: any
  viewer: any
  worldView: any
  ready: Promise<void>
}

let current: CameraState | null = null
let building: Promise<CameraState> | null = null

function isAlive(c: CameraState | null): c is CameraState {
  return !!c && c.bot.entity != null && c.bot.world != null
}

/** 3D 渲染栈是否可用（无头部署返回 false；不触发加载）。 */
export function visionAvailable(): boolean {
  return vision !== null
}

async function build(bot: Bot): Promise<CameraState> {
  const v = await loadVision()
  if (!v) throw new Error(`camera unavailable (vision stack not loadable: ${visionError})`)
  const canvas = v.createCanvas(WIDTH, HEIGHT)
  const renderer = new v.THREE.WebGLRenderer({ canvas })
  const viewer = new v.Viewer(renderer)
  // 1.21.11 新实体（text_display/glow_squid/item…）不在 prismarine-viewer 的
  // 网格注册表里，Entities.update 遇到会 throw 并打断整帧渲染/截图。
  // 包一层 try/catch：未知实体的网格缺失只影响它自己，不许连累整帧。
  const entities = (viewer as unknown as { entities?: { update: (...a: unknown[]) => void } }).entities
  if (entities?.update) {
    const origUpdate = entities.update.bind(entities)
    entities.update = (...a: unknown[]) => {
      try {
        origUpdate(...a)
      } catch { /* unknown entity mesh: skip it, keep the frame */ }
    }
  }
  // 宽视野：Viewer 默认 75，这里按环境变量覆盖（懒初始化后首次截图生效）
  viewer.camera.fov = FOV
  viewer.camera.updateProjectionMatrix()
  console.log(`[mc-camera] camera built: fov=${FOV} (v), view=${VIEW_DISTANCE} chunks, ${WIDTH}x${HEIGHT}`)
  const botPos = bot.entity!.position
  const center = new Vec3(botPos.x, botPos.y + bot.entity!.height, botPos.z)
  viewer.setVersion(bot.version)
  const worldView = new v.WorldView(bot.world as never, VIEW_DISTANCE, center)
  viewer.listen(worldView)
  worldView.listenToBot(bot)
  const state: CameraState = { bot, renderer, canvas, viewer, worldView, ready: Promise.resolve() }
  await worldView.init(center)
  return state
}

function getCamera(bot: Bot): Promise<CameraState> {
  if (isAlive(current) && current!.bot === bot) return Promise.resolve(current!)
  if (isAlive(current) && current!.bot !== bot) {
    // bot 实例换了（重连）：旧 worldView 已随旧 bot 失效，直接弃用
    current = null
  }
  if (!building) {
    if (!bot.entity || !bot.world) throw new Error('camera: bot not spawned yet')
    building = build(bot)
      .then((c) => {
        current = c
        return c
      })
      .finally(() => {
        building = null
      })
  }
  return building
}

async function pruneOld(dir: string): Promise<void> {
  try {
    const files = (await readdir(dir)).filter((f) => f.endsWith('.jpg'))
    if (files.length <= KEEP_SHOTS) return
    // 文件名带时间戳，字典序即时间序
    const sorted = files.sort()
    for (const f of sorted.slice(0, sorted.length - KEEP_SHOTS)) {
      await unlink(join(dir, f)).catch(() => { /* already gone */ })
    }
  } catch { /* best effort */ }
}

/** 等 mesher 追平（懒初始化后的首轮网格化需要几秒；之后 outstanding 常态为 0）。 */
async function waitForMesher(cam: CameraState): Promise<void> {
  const wr = (cam.viewer as unknown as { world?: { sectionsOutstanding: Set<string>; renderUpdateEmitter: { on(e: string, cb: () => void): void; off(e: string, cb: () => void): void } } }).world
  if (!wr || wr.sectionsOutstanding.size === 0) return
  const world = wr
  const emitter = wr.renderUpdateEmitter
  await new Promise<void>((resolve) => {
    const t = setTimeout(done, 15_000) // 上限 15s，超时也硬拍
    function done() {
      clearTimeout(t)
      emitter.off('update', onDone)
      resolve()
    }
    function onDone() {
      if (world.sectionsOutstanding.size === 0) done()
    }
    emitter.on('update', onDone)
  })
}

/**
 * 以指定 yaw/pitch 渲染一帧并出 JPEG。
 * suffix 仅用于落盘文件名区分（如 "-right"），单张传 ''。
 */
async function renderOne(cam: CameraState, bot: Bot, yaw: number, pitch: number, shotsRoot: string | null, suffix: string): Promise<Shot> {
  const e = bot.entity!
  // 保险：若 fov 被外部路径重置，按 FOV 常量纠正
  if (cam.viewer.camera.fov !== FOV) {
    cam.viewer.camera.fov = FOV
    cam.viewer.camera.updateProjectionMatrix()
  }
  const center = new Vec3(e.position.x, e.position.y + e.height, e.position.z)
  cam.viewer.camera.position.set(center.x, center.y, center.z)
  await cam.worldView.updatePosition(center)
  cam.viewer.setFirstPersonCamera(e.position, yaw, pitch)
  cam.viewer.update()
  cam.renderer.render(cam.viewer.scene, cam.viewer.camera)

  // 走 node-canvas-webgl 的 JPEG 流（Mindcraft camera.js 同款路径，toBuffer 在该库上不可靠）
  const { getBufferFromStream } = await import('prismarine-viewer/viewer/lib/simpleUtils.js')
  const imageStream = cam.canvas.createJPEGStream({ bufsize: 4096, quality: 88, progressive: false })
  const raw = (await getBufferFromStream(imageStream)) as unknown as Buffer
  // 截图后叠加实体标注（黄框=玩家、红框=敌对、绿框=友善、橙框=掉落物，标签=类型+距离）
  let buffer: Buffer = raw
  if (ANNOTATE) {
    try {
      buffer = annotateShotSync(raw, bot, yaw, pitch)
    } catch (e) {
      console.warn(`[mc-camera] annotate skipped: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  let file: string | null = null
  if (shotsRoot) {
    const dir = join(shotsRoot, bot.username || 'unknown')
    await mkdir(dir, { recursive: true })
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}${suffix}.jpg`
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, name), buffer)
    file = `${bot.username || 'unknown'}/${name}`
    void pruneOld(dir)
  }
  return { buffer, file }
}

/**
 * 截取 bot 当前第一人称画面。
 * @param shotsRoot 截图根目录（如 ./data/screenshots）；传 null 则不落盘
 */
export async function captureFirstPerson(bot: Bot, shotsRoot: string | null): Promise<Shot> {
  const cam = await getCamera(bot)
  await waitForMesher(cam)
  const e = bot.entity!
  return await renderOne(cam, bot, e.yaw, e.pitch, shotsRoot, '')
}

export interface LookaroundShot extends Shot {
  label: string // 中文方向标签（前方/右方/后方/左方），随图喂给 VLM
  key: string // ASCII 后缀（front/right/back/left），用于文件名
}

/**
 * 环顾四周：原地不动，按 前→右→后→左 拍四张（yaw 每次顺时针 +90°）。
 * 俯仰收平到 ±0.3 rad，避免原视角在盯着天/地时四张全是天空或脚底。
 */
export async function captureLookaround(bot: Bot, shotsRoot: string | null): Promise<LookaroundShot[]> {
  const cam = await getCamera(bot)
  await waitForMesher(cam)
  const e = bot.entity!
  const baseYaw = e.yaw
  const pitch = Math.max(-0.3, Math.min(0.3, e.pitch))
  // mineflayer yaw：0=南(+Z)，+π/2=西；yaw 增大 = 游戏内向右转
  const dirs: Array<{ label: string; key: string; dy: number }> = [
    { label: '前方', key: 'front', dy: 0 },
    { label: '右方', key: 'right', dy: Math.PI / 2 },
    { label: '后方', key: 'back', dy: Math.PI },
    { label: '左方', key: 'left', dy: -Math.PI / 2 },
  ]
  const shots: LookaroundShot[] = []
  for (const d of dirs) {
    const shot = await renderOne(cam, bot, baseYaw + d.dy, pitch, shotsRoot, `-${d.key}`)
    shots.push({ ...shot, label: d.label, key: d.key })
  }
  return shots
}

/** 相机是否已就绪（不触发初始化）。 */
export function cameraReady(): boolean {
  return isAlive(current)
}

/** 仪表信息（测试/诊断用）：viewer 已加载 chunk 数、已建网格数、待处理 section 数。 */
export function __debugState(_bot: Bot): { viewerChunks: number; meshes: number; outstanding: number } | null {
  if (!current) return null
  const w = (current.viewer as unknown as { world?: { loadedChunks: Record<string, unknown>; sectionMeshs: Record<string, unknown>; sectionsOutstanding: Set<unknown> } }).world
  if (!w) return null
  return {
    viewerChunks: Object.keys(w.loadedChunks ?? {}).length,
    meshes: Object.keys(w.sectionMeshs ?? {}).length,
    outstanding: (w.sectionsOutstanding ?? new Set()).size,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// mc_see 图像标注：把附近实体 3D 坐标投影到第一人称画面，PIL 叠加框+标签+HUD。
// 目标：让视觉模型看图时直接读到「这是谁/什么、在哪、多远」，不用靠猜。
// 去名化：玩家一律标「玩家」，不落 username；怪物/NPC 标类型名。
// 开关：MC_EYES_ANNOTATE=0 可关（仍正常出图）。
// ─────────────────────────────────────────────────────────────────────────────
const ANNOTATE = process.env.MC_EYES_ANNOTATE !== '0'
const ANNOTATE_RANGE = 24 // 实体标注范围（格）

const HOSTILE = new Set([
  'zombie', 'zombie_villager', 'drowned', 'husk', 'skeleton', 'stray', 'bogged',
  'spider', 'cave_spider', 'creeper', 'enderman', 'witch', 'slime', 'magma_cube',
  'phantom', 'blaze', 'ghast', 'hoglin', 'zoglin', 'vex', 'vindicator', 'pillager',
  'ravager', 'warden', 'guardian', 'elder_guardian', 'shulker', 'silverfish',
  'endermite', 'breeze', 'pale_spider',
])
const FRIENDLY = new Set([
  'villager', 'wandering_trader', 'cow', 'pig', 'sheep', 'chicken', 'rabbit',
  'mooshroom', 'turtle', 'fox', 'cat', 'dolphin', 'parrot', 'horse', 'donkey',
  'mule', 'llama', 'trader_llama', 'bee', 'strider', 'allay', 'axolotl', 'goat',
  'ocelot', 'wolf', 'iron_golem', 'snow_golem', 'panda', 'piglin', 'zombified_piglin',
  'camel', 'sniffer', 'armadillo', 'frog', 'tadpole', 'glow_squid', 'squid', 'bat',
  'cod', 'salmon', 'pufferfish', 'tropical_fish',
])

/** 实体分类着色：玩家=金、敌对=红、友善=绿、掉落物=橙、其他=灰。 */
function kindInfo(ent: { type?: string; name?: string }): { label: string; color: [number, number, number] } {
  const t = ent.type
  const n = ent.name ?? ''
  if (t === 'player') return { label: '玩家', color: [255, 215, 0] }
  if (t === 'object') return { label: '掉落物', color: [255, 150, 40] }
  if (t === 'mob') {
    if (HOSTILE.has(n)) return { label: n, color: [255, 70, 70] }
    if (FRIENDLY.has(n)) return { label: n, color: [90, 220, 90] }
    return { label: n || '生物', color: [190, 190, 190] }
  }
  return { label: n || '实体', color: [190, 190, 190] }
}

/** 相对方位（8 方位），与 mc_scan 雷达同规则。 */
function relDir8(dx: number, dz: number): string {
  const ax = Math.abs(dx)
  const az = Math.abs(dz)
  const vert = dz < 0 ? '北' : '南'
  const horiz = dx < 0 ? '西' : '东'
  if (ax < az * 0.3) return vert
  if (az < ax * 0.3) return horiz
  return vert + horiz
}

/**
 * 3D→2D 投影：把实体世界坐标投到第一人称画面坐标。
 * 相机基向量：forward（yaw/pitch 决定）、right、up；透视投影 focal = (H/2)/tan(FOV/2)。
 * 返回画面内包围盒（像素），或 null（相机背后 / 出画面太远）。
 */
function projectEntity(
  pos: { x: number; y: number; z: number },
  eye: { x: number; y: number; z: number },
  yaw: number,
  pitch: number,
  focal: number,
  halfW: number,
  halfH: number,
): { x: number; y: number; w: number; h: number } | null {
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  // mineflayer yaw：0=南(+Z)，增大=向右（顺时针）；pitch：正=向下看
  const fx = -sy * cp
  const fy = -sp
  const fz = cy * cp
  const rx = -fz
  const ry = 0
  const rz = fx
  const ux = ry * fz - rz * fy
  const uy = rz * fx - rx * fz
  const uz = rx * fy - ry * fx
  const dx = pos.x - eye.x
  const dy = pos.y - eye.y
  const dz = pos.z - eye.z
  const zc = dx * fx + dy * fy + dz * fz
  if (zc < 0.4) return null // 相机背后 / 贴脸
  const xc = dx * rx + dy * ry + dz * rz
  const yc = dx * ux + dy * uy + dz * uz
  const px = WIDTH / 2 + (xc / zc) * focal
  const py = HEIGHT / 2 - (yc / zc) * focal
  const wpx = (halfW / zc) * focal
  const hpx = (halfH / zc) * focal
  if (px < -wpx * 3 || px > WIDTH + wpx * 3 || py < -hpx * 3 || py > HEIGHT + hpx * 3) return null
  return { x: Math.round(px - wpx), y: Math.round(py - hpx), w: Math.max(8, Math.round(wpx * 2)), h: Math.max(8, Math.round(hpx * 2)) }
}

/** 内嵌 PIL 标注脚本（spawn python -c 执行，避免发布包携带额外文件）。 */
const PY_ANNOTATE = `
import sys, json
from PIL import Image, ImageDraw, ImageFont
inp, outp, annsPath = sys.argv[1], sys.argv[2], sys.argv[3]
anns = json.load(open(annsPath, encoding='utf-8'))
im = Image.open(inp).convert('RGBA')
ov = Image.new('RGBA', im.size, (0, 0, 0, 0))
od = ImageDraw.Draw(ov)
ents = anns.get('entities', [])
for e in ents:
    col = tuple(e.get('color', [255, 215, 0]))
    od.rectangle([e['x'], e['y'], e['x'] + e['w'], e['y'] + e['h']],
                 fill=col + (40,), outline=col + (255,), width=2)
hud = anns.get('hud', '')
if hud:
    od.rectangle([8, im.size[1] - 36, im.size[0] - 8, im.size[1] - 8], fill=(0, 0, 0, 185))
im = Image.alpha_composite(im, ov)
dr = ImageDraw.Draw(im)
def getfont(sz):
    for p in ['C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/simhei.ttf', 'C:/Windows/Fonts/msyhbd.ttc', 'C:/Windows/Fonts/arial.ttf']:
        try:
            return ImageFont.truetype(p, sz)
        except Exception:
            pass
    return ImageFont.load_default()
for e in ents:
    col = tuple(e.get('color', [255, 215, 0]))
    label = e.get('label', '')
    f = getfont(13)
    tw = dr.textlength(label, font=f)
    lx = max(2, e['x'])
    ly = e['y'] - 19
    if ly < 2:
        ly = e['y'] + e['h'] + 2
    lx2 = min(im.size[0] - 2, lx + tw + 6)
    dr.rectangle([lx, ly, lx2, ly + 17], fill=(0, 0, 0, 190))
    dr.text((lx + 3, ly + 1), label, fill=(255, 255, 255), font=f)
if hud:
    f2 = getfont(15)
    dr.text((14, im.size[1] - 31), hud, fill=(255, 255, 255), font=f2)
im.convert('RGB').save(outp, quality=90)
`

/**
 * 同步标注一张第一人称截图：投影附近实体 → PIL 画框+标签+HUD。
 * 画面内没有可标注实体时原样返回（省一次 python 调用）。
 */
function annotateShotSync(jpeg: Buffer, bot: Bot, yaw: number, pitch: number): Buffer {
  if (!bot.entity) return jpeg
  const focal = HEIGHT / 2 / Math.tan((FOV * Math.PI) / 180 / 2)
  const eye = { x: bot.entity.position.x, y: bot.entity.position.y + 1.62, z: bot.entity.position.z }
  const myPos = bot.entity.position
  const anns: Array<{ x: number; y: number; w: number; h: number; label: string; color: [number, number, number] }> = []
  const dirs: string[] = []
  for (const [, e] of bot.entities) {
    if (!e || !e.position) continue
    const dist = myPos.distanceTo(e.position)
    if (dist > ANNOTATE_RANGE) continue
    const kind = kindInfo(e)
    const halfW = (e.width ?? 0.5) / 2
    const halfH = (e.height ?? 1.8) / 2
    const p = projectEntity(e.position, eye, yaw, pitch, focal, halfW, halfH)
    if (!p) continue
    p.label = `${kind.label} ${Math.round(dist)}格`
    p.color = kind.color
    anns.push(p)
    dirs.push(`${relDir8(e.position.x - eye.x, e.position.z - eye.z)} ${kind.label}${Math.round(dist)}格`)
  }
  if (anns.length === 0) return jpeg
  const hud = `${anns.length} 个实体：${dirs.slice(0, 4).join(' · ')}${dirs.length > 4 ? ` 等${dirs.length}个` : ''}`
  const base = join(tmpdir(), `mc-anns-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const inp = base + '.in.jpg'
  const outp = base + '.out.jpg'
  const annPath = base + '.json'
  try {
    writeFileSync(inp, jpeg)
    writeFileSync(annPath, JSON.stringify({ entities: anns, hud }))
    const r = spawnSync('python', ['-c', PY_ANNOTATE, inp, outp, annPath], { encoding: 'utf-8', timeout: 10_000 })
    if (r.status !== 0) {
      console.warn(`[mc-camera] annotate failed: ${String(r.stderr || r.error || '').slice(0, 300)}`)
      return jpeg
    }
    return readFileSync(outp)
  } finally {
    for (const p of [inp, outp, annPath]) {
      try { unlinkSync(p) } catch { /* already gone */ }
    }
  }
}
