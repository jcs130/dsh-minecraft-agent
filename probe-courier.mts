/**
 * probe-courier.mts —— 信使送达端到端探针（单 bot）。
 * 验证 2026-08-17 扛枪定调：施法回执/成长通告走 [信使] whisper，
 * 公屏不再播个人回执。
 * 前置：世界进程（bootstrap-world）在跑。用后即弃，零权限。
 */
import mineflayer from 'mineflayer'

const HOST = process.env.MC_HOST ?? '127.0.0.1'
const PORT = 25565
const NAME = 'ProbeC'

const bot = mineflayer.createBot({ host: HOST, port: PORT, username: NAME })

interface Heard { kind: 'whisper' | 'public'; from: string; text: string }
const heard: Heard[] = []

bot.on('whisper', (from, text) => {
  heard.push({ kind: 'whisper', from, text })
  console.log(`[whisper:${from}] ${text}`)
})
bot.on('chat', (from, text) => {
  // 公屏聊天（含女神公屏播报）
  heard.push({ kind: 'public', from, text })
  console.log(`[public:${from}] ${text}`)
})

function wait(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

async function main() {
  await new Promise<void>((r) => bot.once('spawn', () => r()))
  console.log('spawned, waiting out ritual ...')
  await wait(30000) // 降临仪式宣读 + 缓冲

  console.log('--- chant appraise (public) ---')
  bot.chat('鉴定我')
  await wait(6000)

  console.log('--- wait xp courier (triggered externally via RCON) ---')
  await wait(25000) // 外部脚本 xp add → god 轮询 12s → courier

  bot.quit()
  await wait(1500)

  const whispers = heard.filter((h) => h.kind === 'whisper' && h.from === 'Goddess')
  const publics = heard.filter((h) => h.kind === 'public' && (h.text.includes('ProbeC') || h.text.includes('鉴定')))

  const checks: Array<[boolean, string]> = [
    [whispers.some((w) => w.text.includes('[信使]') && (w.text.includes('鉴定') || w.text.includes('面板'))), 'cast receipt via [信使] whisper'],
    [whispers.some((w) => w.text.includes('[信使]') && w.text.includes('修行有了回报')), 'level-up via [信使] whisper'],
    [!publics.some((p) => p.text.includes('[女神]') && (p.text.includes('鉴定') || p.text.includes('修行有了回报'))), 'no public cast/level receipt'],
  ]
  let fail = 0
  for (const [ok, label] of checks) {
    console.log(`${ok ? 'ok ' : 'FAIL'} ${label}`)
    if (!ok) fail++
  }
  console.log(fail === 0 ? 'COURIER E2E ALL PASS' : `COURIER E2E ${fail} FAILED`)
  process.exit(fail === 0 ? 0 : 1)
}

setTimeout(() => { console.error('probe timeout'); bot.quit(); process.exit(2) }, 100_000)
main().catch((e) => { console.error('probe error', e); bot.quit(); process.exit(3) })
