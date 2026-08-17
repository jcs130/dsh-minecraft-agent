// mc-evolve 端到端验证：add 记忆 → 多路 recall → vLLM 深思考复盘 → JSON 解析 → 写回验证
// 完全模拟插件运行时行为（协议/prompt/解析与 mc-evolve.ts 一致），测试池 mc-evotest 隔离。
const MEMOS = 'http://127.0.0.1:8002'
const LLM = 'http://127.0.0.1:8890/v1'
const TESTUSER = 'evotest'
const uid = 'mc-' + TESTUSER

async function memos(path, body) {
  const res = await fetch(MEMOS + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return res.json()
}

const results = []
function check(name, ok, extra = '') { results.push([name, ok]); console.log(ok ? 'PASS' : 'FAIL', name, extra) }

// 1) 造一天的经历记忆
const day = [
  '在(-160,63,120)南边河谷挖到32块铁锭，后来全部卖给铁匠岳山换了11颗绿宝石。',
  '第一次独自走夜路遇到苦力怕，被炸掉一半血，慌乱逃跑时掉进河里，记住：夜间赶路要靠水边走并常回头。',
  '和讲述者风临聊了很久，他答应明天告诉我东边沼泽女巫小屋的具体方位，我也要带小麦给他当谢礼。',
  '发现自己总是天黑了才开始找住处，太被动。明天要在日落前一小时就开始准备回城。',
]
for (const m of day) {
  const r = await memos('/product/add', { user_id: uid, messages: [{ role: 'assistant', content: m }] })
  if (r.code !== 200) { console.log('add FAIL', r); process.exit(1) }
}
check('造记忆 4 条', true)

// 2) 多路宽查询 recall（同插件 RECALL_QUERIES）
await new Promise(r => setTimeout(r, 5000))
const QUERIES = ['经历 事件 今天', '交易 获得物品 资源', '朋友 交互 约定', '危险 教训 失败 死亡', '发现 新地点 探索']
const seen = new Set()
const memories = []
for (const q of QUERIES) {
  const r = await memos('/product/search', { user_id: uid, query: q, mode: 'fast' })
  const d = r.data ?? {}
  for (const layer of ['text_mem', 'act_mem', 'para_mem', 'pref_mem'])
    for (const cube of d[layer] ?? [])
      for (const m of cube.memories ?? []) {
        const t = String(m.memory ?? '').trim().replace(/\s+/g, ' ').slice(0, 200)
        if (t && !seen.has(t)) { seen.add(t); memories.push(t) }
      }
}
check('多路 recall 汇总 >=3 条', memories.length >= 3, `(实得 ${memories.length})`)

// 3) vLLM 深思考复盘（reasoning_effort=high，同插件 prompt）
const system = [
  '你是「夜间自省」机制：扮演这位穿越者的内心，对 TA 今天的经历做一次深夜复盘。',
  '穿越者白天快速行动没空细想；现在夜深了，替 TA 把散落的经历蒸馏成成长。',
  '只输出一个 JSON 对象（不要 markdown 代码块）：',
  '{"growth":"人格成长叙事，80-150字，要有情感和具体事件",',
  ' "resolve":"对明日的具体决心，1-2句，可执行",',
  ' "lessons":[{"topic":"≤16字短标题","content":"≤100字具体教训，含下次该怎么做"}]}',
  'lessons 给 2-4 条：只沉淀泛化可复用的生存智慧/社交心得，不写流水账，不与已知教训重复。',
].join('\n')
const user = [
  `穿越者：${TESTUSER}`,
  `今日记忆（${memories.length} 条）：`,
  ...memories.slice(0, 40).map(m => `- ${m}`),
  '',
  `已有教训卡话题（别重复）：(无)`,
].join('\n')

const t0 = Date.now()
const llmRes = await fetch(LLM + '/chat/completions', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk-local' },
  body: JSON.stringify({
    model: 'qwen3.8', messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.6, max_tokens: 2048, reasoning_effort: 'xhigh', stream: false,
  }),
})
check('vLLM 复盘 HTTP 200', llmRes.ok)
const llmData = await llmRes.json()
const raw = llmData?.choices?.[0]?.message?.content ?? ''
const s = raw.indexOf('{'), e = raw.lastIndexOf('}')
let out = null
if (s >= 0 && e > s) { try { out = JSON.parse(raw.slice(s, e + 1)) } catch {} }
check('复盘输出可解析 JSON', !!out, `(${((Date.now() - t0) / 1000).toFixed(1)}s)`)

if (out) {
  const lessons = (out.lessons ?? []).filter(l => l?.topic && l?.content)
  check('lessons 2-4 条', lessons.length >= 2 && lessons.length <= 4, `(实得 ${lessons.length})`)
  check('growth 非空', !!out.growth, String(out.growth ?? '').slice(0, 60))
  console.log('   growth 示例:', String(out.growth).slice(0, 100))
  console.log('   lesson[0]:', lessons[0]?.topic, '|', String(lessons[0]?.content).slice(0, 70))
  check('resolve 非空', !!out.resolve, String(out.resolve ?? '').slice(0, 50))

  // 4) 写回验证（MemOS 记 growth；wiki 本地写由插件做，此处只验 MemOS 通道）
  const wr = await memos('/product/add', { user_id: uid, messages: [{ role: 'assistant', content: `【夜间进化测试】${out.growth} 明日之心：${out.resolve}` }] })
  check('growth 写回 MemOS', wr.code === 200)
}

const failed = results.filter(([, ok]) => !ok)
console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL PASS')
process.exit(failed.length ? 1 : 0)
