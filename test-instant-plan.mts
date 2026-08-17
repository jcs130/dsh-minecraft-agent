// 离线单测：planInstantReply（程序化预过滤纯函数，无需 MC/LLM）
import { planInstantReply } from './src/mc-god.ts'

const atoms = [
  { id: 'home', name: '归乡', words: ['归乡', '回家', '回基地'], cost: { mana: 20 } },
  { id: 'tp', name: '空间传送', words: ['传送', '瞬移'], cost: { mana: 20 } },
  { id: 'give', name: '造物术', words: ['造物', '赐予', '给我'], cost: { mana: 20 } },
]

const cases: Array<{ label: string; wish: string; view: { mana: number; learned: string[]; innateSkill: string | null }; expect: 'instant-self' | 'instant-wait' | 'null' }> = [
  { label: '已学会+魔力够 → 点拨自己咏唱', wish: '女神，请施展神力送我回家', view: { mana: 50, learned: ['home'], innateSkill: null }, expect: 'instant-self' },
  { label: '已学会+魔力不足 → 告知回蓝秒数', wish: '请送我回家', view: { mana: 5, learned: ['home'], innateSkill: null }, expect: 'instant-wait' },
  { label: '未学会(learned不含) → 交LLM', wish: '我尚未学会传送之术，请送我向东十格', view: { mana: 90, learned: ['home'], innateSkill: null }, expect: 'null' },
  { label: '天赋豁免=innate即已习得 → 点拨', wish: '请帮我传送十格', view: { mana: 50, learned: [], innateSkill: 'tp' }, expect: 'instant-self' },
  { label: '未学会的造物 → 交LLM', wish: '请赐予我食物', view: { mana: 50, learned: ['home'], innateSkill: null }, expect: 'null' },
  { label: '无关祈愿(无关键词) → 交LLM', wish: '女神，今晚的月亮真美', view: { mana: 50, learned: ['home'], innateSkill: null }, expect: 'null' },
]

let pass = 0
let fail = 0
for (const c of cases) {
  const r = planInstantReply(c.wish, c.view, atoms as any, 2.0)
  const kind = r === null ? 'null' : (r.includes('魔力不足') ? 'instant-wait' : 'instant-self')
  const ok = kind === c.expect
  if (ok) pass++; else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} [${c.label}]`)
  console.log(`     -> ${r ?? '(null, 交LLM裁量)'}`)
}
console.log(`\n${pass}/${pass + fail} passed`)
process.exit(fail === 0 ? 0 : 1)
