/**
 * probe-social.mts —— mc-social 端到端探针（双 bot：好友→互信→写信→拆信→传声）。
 * 用后即弃；只依赖 mineflayer，零权限。
 */
import mineflayer from 'mineflayer'

const HOST = process.env.MC_HOST ?? '127.0.0.1'
const PORT = 25565
const GOD = process.env.MC_GOD_NAME ?? 'Goddess'

function mk(name: string) {
  return mineflayer.createBot({ host: HOST, port: PORT, username: name })
}

const seen: { who: string; text: string }[] = []
function record(bot: mineflayer.Bot, tag: string) {
  bot.on('message', (msg) => {
    const text = msg.toString()
    if (text.includes('Probe') || text.includes('女神') || text.includes('信差') || text.includes('传声') || text.includes('转达')) {
      seen.push({ who: tag, text })
      console.log(`[${tag}] ${text}`)
    }
  })
}

function wait(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

async function main() {
  const A = mk('ProbeA')
  const B = mk('ProbeB')
  record(A, 'A')
  record(B, 'B')
  await Promise.all([
    new Promise<void>((r) => A.once('spawn', () => r())),
    new Promise<void>((r) => B.once('spawn', () => r())),
  ])
  await wait(2500)
  // 降临仪式串行宣读（~700ms/行 × 2 玩家），等女神念完再开测，避免与仪式抢话筒。
  await wait(25000)

  const steps: Array<[mineflayer.Bot, string, string]> = [
    [A, '/friend add ProbeB', 'friend-add A->B'],
    [B, '/friend accept ProbeA', 'friend-accept B'],
    [A, '/mail send ProbeB 测试信：明天矿洞见，带镐子', 'mail A->B'],
    [B, '/mail read', 'mail read B'],
    [A, '说：传声测试，能听见吗', 'voice say'],
  ]
  for (const [bot, msg, label] of steps) {
    console.log(`--- ${label} ---`)
    bot.whisper(GOD, msg)
    await wait(4000)
  }

  const all = seen.map((s) => s.text).join('\n')
  const checks: Array<[string, string]> = [
    ['好友请求已送给', 'friend add ack'],
    ['想与你结为好友', 'B got request notice'],
    ['结为好友', 'accept ack'],
    ['信已送入', 'mail sent ack'],
    ['来信：', 'B got letter (inline)'],
    ['已读 1 封', 'mail read ack'],
    ['传声', 'voice ack to A'],
    ['[ProbeA] 传声测试', 'B heard relay (tellraw)'],
  ]
  let fail = 0
  for (const [needle, label] of checks) {
    const ok = all.includes(needle)
    console.log(`${ok ? 'ok ' : 'FAIL'} ${label}（${needle}）`)
    if (!ok) fail++
  }

  A.quit(); B.quit()
  await wait(1000)
  console.log(fail === 0 ? 'E2E ALL PASS' : `E2E ${fail} FAILED`)
  process.exit(fail === 0 ? 0 : 1)
}

setTimeout(() => { console.error('probe timeout'); process.exit(2) }, 90_000)
main().catch((e) => { console.error('probe error', e); process.exit(3) })
