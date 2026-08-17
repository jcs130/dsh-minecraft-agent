// 单元级验证 mc-memos 逻辑：不起 MC 服务器，用与插件相同的 REST 协议实测
// add(messages 格式) -> search(fast) -> 隔离性，模拟插件 service 层的每一步。
const BASE = process.env.MC_MEMOS_URL ?? 'http://127.0.0.1:8002'
function userIdOf(u) { return 'mc-' + u.toLowerCase() }

async function call(path, body) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const res = await fetch(BASE + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: ctrl.signal,
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return await res.json()
  } finally { clearTimeout(timer) }
}

const results = []
function check(name, ok) { results.push([name, ok]); console.log(ok ? 'PASS' : 'FAIL', name) }

// 1) remember（同插件协议：messages 单条 assistant）
const addBody = { user_id: userIdOf('UnitTestBot'), messages: [{ role: 'assistant', content: '单元测试：在南边河谷(-160,63,120)发现露天铁矿，还遇见村民钟离。' }] }
const r1 = await call('/product/add', addBody)
check('add messages 格式 code=200', r1.code === 200)

// 2) recall 命中
await new Promise(r => setTimeout(r, 4000))
const r2 = await call('/product/search', { user_id: userIdOf('UnitTestBot'), query: '铁矿 河谷 坐标', mode: 'fast' })
const hits2 = []
for (const layer of ['text_mem', 'act_mem', 'para_mem', 'pref_mem'])
  for (const cube of r2.data?.[layer] ?? [])
    for (const m of cube.memories ?? []) hits2.push(String(m.memory ?? ''))
check('recall 语义命中 >=1', hits2.length >= 1)
if (hits2.length) console.log('   命中:', hits2[0].replace(/\s+/g, ' ').slice(0, 100))

// 3) 隔离：别的 user 搜不到
const r3 = await call('/product/search', { user_id: userIdOf('OtherBot'), query: '铁矿 河谷', mode: 'fast' })
const hits3 = []
for (const layer of ['text_mem', 'act_mem', 'para_mem', 'pref_mem'])
  for (const cube of r3.data?.[layer] ?? [])
    for (const m of cube.memories ?? []) hits3.push(String(m.memory ?? ''))
check('跨 user 隔离（OtherBot 0 命中）', hits3.length === 0)

// 4) 中文 user_id（bot 名可能是中文？现状 Kirito/Naruto 英文，但留证）
const r4 = await call('/product/add', { user_id: 'mc-单元测试', messages: [{ role: 'assistant', content: '中文 user_id 写入测试。' }] })
check('中文 user_id add 兼容', r4.code === 200)

const failed = results.filter(([, ok]) => !ok)
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS')
process.exit(failed.length ? 1 : 0)
