import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { compactionForBudget, overflowFinish, selectTools, slimSchema, slimDescription, compactEvents, capBlocks,
  ChatGuard, NoopRounds, goalClosed, redactUrl, CONTEXT_WINDOW_EXCEEDED } from '../src/harness-budget.mjs';

const require = createRequire(import.meta.url);
const threshold = (o, window, reserved) => Math.floor(Math.min(window * o.thresholdRatio, window - reserved - o.headroomTokens));

test('compaction triggers from contextTokens, not the 1M model window', () => {
  const config = { contextTokens: 131072, maxTokens: 2000, compaction: { maxTokens: 2000 } };
  const { options, triggerTokens } = compactionForBudget(config, 1_000_000);
  assert.equal(triggerTokens, Math.floor(131072 * 0.55));
  assert.equal(threshold(options, 1_000_000, 2000), triggerTokens);
  assert.ok(options.retainTokens < triggerTokens);
  assert.ok(triggerTokens + 2000 < config.contextTokens);
});

test('a legacy thresholdRatio past the plugin budget fails at startup instead of mid-session', () => {
  assert.throws(() => compactionForBudget({ contextTokens: 96000, compaction: { thresholdRatio: 0.7 } }, 1_000_000), /triggerRatio/);
  assert.throws(() => compactionForBudget({ contextTokens: 2_000_000 }, 1_000_000), /exceeds the model window/);
  assert.throws(() => compactionForBudget({ contextTokens: 131072 }, undefined), /unknown/);
});

test('budget overflow is an in-band finish DSH compaction answers with compact-and-retry', async () => {
  const llm = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href);
  const chunk = overflowFinish(140000, 131072);
  assert.equal(chunk.type, 'finish'); assert.equal(chunk.reason.kind, 'error');
  assert.equal(chunk.reason.failure.code, llm.CONTEXT_WINDOW_EXCEEDED_CODE);
  assert.equal(CONTEXT_WINDOW_EXCEEDED, llm.CONTEXT_WINDOW_EXCEEDED_CODE);
  const compaction = readFileSync(require.resolve('@deepseek-ai/dsh-compaction-basic'), 'utf8');
  assert.match(compaction, /failure\.code !== CONTEXT_WINDOW_EXCEEDED_CODE/);
});

test('lean tool profile drops rarely used tools and keeps constraints while dropping prose', () => {
  const specs = ['mc_do', 'mc_script', 'mc_blueprint', 'mc_trace', 'mc_tool_help'].map(name => ({ name }));
  assert.deepEqual(selectTools(specs).map(t => t.name), ['mc_do', 'mc_script', 'mc_tool_help']);
  assert.deepEqual(selectTools(specs, { include: ['mc_script'] }).map(t => t.name), ['mc_do', 'mc_script', 'mc_tool_help']);
  assert.deepEqual(selectTools(specs, { exclude: ['mc_script'] }).map(t => t.name), ['mc_do', 'mc_tool_help']);
  assert.deepEqual(selectTools([{ name: 'mymc_script' }]).map(t => t.name), ['mymc_script']);
  assert.equal(selectTools(specs, { profile: 'full' }).length, 4);
  const schema = { type: 'object', description: 'x'.repeat(500), properties: { steps: { type: 'array', description: 'long '.repeat(80),
    items: { type: 'object', properties: { skill: { type: 'string', enum: ['goto', 'chat'], description: 'nested prose' } }, required: ['skill'] } } } };
  const slim = slimSchema(schema, 40);
  assert.equal(slim.description, undefined);
  assert.ok(slim.properties.steps.description.length <= 41);
  assert.deepEqual(slim.properties.steps.items.properties.skill, { type: 'string', enum: ['goto', 'chat'] });
  assert.deepEqual(slim.properties.steps.items.required, ['skill']);
  const d = slimDescription({ description: '第一句。'.repeat(200) }, 'mc_tool_help', 100);
  assert.ok(d.length < 130 && d.endsWith('（完整说明：mc_tool_help）'));
});

test('event snapshot is bounded and receipts are capped for the model', () => {
  const events = Array.from({ length: 30 }, (_, i) => ({ cursor: i, ts: '2026-10-19T22:23:25.021+08:00', type: 'mymc.chat',
    text: 'MC_STATUS ' + '{"a":1}'.repeat(200), meta: { big: 'x'.repeat(1000) } }));
  const out = compactEvents(events, 10, 200);
  assert.equal(out.length, 10); assert.equal(out[0].cursor, 20); assert.equal(out[0].at, '22:23:25');
  assert.equal(out[0].meta, undefined); assert.ok(out[0].text.length <= 201);
  const capped = capBlocks([{ type: 'text', text: 'y'.repeat(5000) }, { type: 'image', data: '' }], 1500);
  assert.ok(capped[0].text.startsWith('y'.repeat(1500)) && capped[0].text.includes('dsh_history'));
  assert.equal(capped[1].type, 'image');
});

test('chat guard enforces the public line cap, spacing and the reserved goodbye', () => {
  let now = 0;
  const guard = new ChatGuard({ maxPublicLines: 4, minIntervalMs: 20000, goodbye: '我先下线啦，再见～' }, () => now);
  const say = text => guard.check('mymc_do', { steps: [{ skill: 'chat', text }] });
  assert.equal(say('大家好'), null);
  now += 5000; assert.match(say('还是不说了'), /不足 20 秒/);
  assert.equal(guard.check('mymc_do', { steps: [{ skill: 'chat', text: '/msg ag_CorMy 你好' }] }), null); // whisper not counted
  assert.equal(guard.check('mymc_do', { steps: [{ skill: 'chat', text: '/minecraft:tell Alice 你好' }] }), null);
  now += 30000; assert.equal(say('第二句'), null);
  now += 30000; assert.equal(say('第三句'), null);
  now += 30000; const refusal=say('第四句');assert.match(refusal, /上限（3 句，另留 1 句下线道别/);
  assert.doesNotMatch(refusal,/私聊请用|\/msg/);assert.match(refusal,/不要改用私聊绕过限额/);
  assert.equal(guard.check('mymc_goal', { done: 1 }), null);
  assert.equal(guard.takeGoodbye(), '我先下线啦，再见～');
  assert.equal(guard.takeGoodbye(), null);
});

test('normal conversation has no default lifetime sentence cap and still observes spacing',()=>{
  let now=0;const guard=new ChatGuard({},()=>now);
  const say=()=>guard.check('mc_do',{steps:[{skill:'chat',text:'@Alice 你好'}]});
  for(let i=0;i<8;i++){assert.equal(say(),null);now+=5000;}
  assert.equal(say(),null);assert.match(say(),/不足 5 秒/);
});

test('repeated no-op rounds are detected and in-game goal closure is recognized', () => {
  const rounds = new NoopRounds(3, name => name.startsWith('mymc_'));
  rounds.call('mymc_do'); assert.equal(rounds.end(), false);
  rounds.call('get_goal'); assert.equal(rounds.end(), false);
  assert.equal(rounds.end(), false);
  assert.equal(rounds.end(), true);
  assert.equal(goalClosed({ structuredContent: { meta: { goalClosure: { phase: 'closed' } } } }), true);
  assert.equal(goalClosed({ structuredContent: { text: 'ok' } }), false);
});

test('access tokens are masked in logged URLs', () => {
  assert.equal(redactUrl('dsh web: http://127.0.0.1:3091/?token=abcDEF-123'), 'dsh web: http://127.0.0.1:3091/?token=***');
  assert.equal(redactUrl('http://127.0.0.1:17851/'), 'http://127.0.0.1:17851/');
});

test('host wires the guards: lean tools, overflow retry, signals, stopped status and default rounds', () => {
  const src = readFileSync(new URL('../src/mc-harness.mjs', import.meta.url), 'utf8');
  assert.match(src, /yield overflowFinish\(/);
  assert.doesNotMatch(src, /throw Error\('Minecraft request exceeds/);
  assert.match(src, /process\.once\(signal, onSignal\)/);
  assert.match(src, /status\(\{ state: 'stopped', stopped: true/);
  assert.match(src, /maxGoalRounds: config\.maxGoalRounds \?\? 40 \}/);
  assert.doesNotMatch(src, /\?\? 2000/);
  assert.match(src, /chat\.check\(spec\.name, args\)/);
  assert.match(src, /goalClosed\(value\)/);
  assert.match(src, /maxCalls: config\.maxGoalCalls \?\? DEFAULT_MAX_GOAL_CALLS/);
  assert.match(src, /new CraftSyncGuard/);
  assert.match(src, /survivalHint\(facts, survival\)/);
  assert.doesNotMatch(src, /maxCalls: config\.maxGoalCalls \?\? 30/);
});

test('wake filter offers public conversation and suppresses countdowns, self and system chat', async () => {
  const { classifyWakeFallback, WAKE_ACTIVE_GOAL } = await import('../src/harness-budget.mjs');
  const self = { selfNames: ['ag_jojo', 'Jojo'] };
  const chat = (text, uname, trigger = 'debounce') => ({ type: 'mymc.chat', text, trigger, ...(uname ? { meta: { uname } } : {}) });
  assert.equal(classifyWakeFallback(chat('[MC] ag_CorMy: 小鱼早呀~ 天亮了', 'ag_CorMy'), self).wake, true);
  assert.equal(classifyWakeFallback(chat('[MC] ag_CorMy: 天亮了', 'ag_CorMy'), {...self,wakeOn:['mention','whisper']}).wake, false);
  assert.equal(classifyWakeFallback(chat('[MC] ag_CorMy: 欢迎回来 Jojo~', 'ag_CorMy', 'flush'), self).category, 'mention');
  assert.equal(classifyWakeFallback(chat('[MC 私聊] ag_CorMy: 在吗'), self).wake, true);
  assert.equal(classifyWakeFallback(chat('[MC 插件] 槽位1', undefined, 'flush'), self).wake, false);
  assert.equal(classifyWakeFallback({ type: 'mymc.event', text: '[Minecraft] ☆ 旅人顺风 | 1:25 状态条进度为 47%。', trigger: 'debounce' }, self).wake, false);
  assert.equal(classifyWakeFallback({ type: 'mymc.event', text: '[Minecraft] 濒死!生命只剩 3/20', trigger: 'flush' }, self).wake, true);
  const task = { type: 'mymc.task', text: '[执行器] 任务#6 完成', trigger: 'flush' };
  assert.equal(classifyWakeFallback(task, self).wake, false);
  assert.equal(classifyWakeFallback(task, { ...self, wakeOn: WAKE_ACTIVE_GOAL }).wake, true);
});

test('local compact schema collapses the mc_do field pool but keeps the skill enum and signatures', async () => {
  const { slimToolSchema } = await import('../src/harness-budget.mjs');
  const pool = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`f${i}`, { type: 'integer', minimum: 0, description: 'note' }]));
  const schema = { type: 'object', required: ['steps'], properties: {
    steps: { type: 'array', description: 'goto(at*) — 走过去\nchat(text*)', items: { type: 'object', required: ['skill'],
      properties: { skill: { type: 'string', enum: ['goto', 'chat'], description: 'x' }, ...pool } } },
    queue: { type: 'string', enum: ['now', 'append'], description: 'long '.repeat(40) } } };
  const slim = slimToolSchema(schema, 40);
  assert.deepEqual(slim.properties.steps.items, { type: 'object', properties: { skill: { type: 'string', enum: ['goto', 'chat'] } }, required: ['skill'], additionalProperties: true });
  assert.equal(slim.properties.steps.description, 'goto(at*) — 走过去\nchat(text*)');
  assert.deepEqual(slim.properties.queue.enum, ['now', 'append']);
  assert.deepEqual(slim.required, ['steps']);
});

test('fallback wake classifier matches the core when the installed core provides one', async t => {
  const core = await import('agent-mc-world/client');
  if (typeof core.classifyWake !== 'function') return t.skip('installed agent-mc-world predates classifyWake');
  const { classifyWakeFallback } = await import('../src/harness-budget.mjs');
  for (const event of [{ type: 'mymc.chat', text: '[MC] a: hi Jojo', meta: { uname: 'a' } }, { type: 'mymc.event', text: '濒死', trigger: 'flush' }])
    assert.deepEqual(classifyWakeFallback(event, { selfNames: ['Jojo'] }), core.classifyWake(event, { selfNames: ['Jojo'] }));
});

test('goal progress guard nudges, then closes, on wandering in one plaza; resets per goal; enforces call budget', async () => {
  const { GoalProgressGuard, MovementProgressFallback, withNotice } = await import('../src/harness-budget.mjs');
  const guard = new GoalProgressGuard({ progress: new MovementProgressFallback(), maxCalls: 3, closeAfter: 8 });
  const goal = { id: 'g1', phase: 'active' };
  const results = [];
  for (let i = 0; i < 8; i++) results.push(guard.action(goal, [{ skill: 'goto', at: [-536 + (i % 3) * 6, 67, -450 + (i % 2) * 6] }]));
  assert.deepEqual(results.slice(0, 5), [{}, {}, {}, {}, {}]);
  assert.match(results[5].notice, /update_goal/);
  assert.match(results[7].close, /8 movement-only actions/);
  assert.deepEqual(guard.action({ phase: 'complete' }, [{ skill: 'goto', at: [0, 0, 0] }]), {});
  assert.equal(guard.step(goal), null); guard.step(goal); guard.step(goal);
  assert.match(guard.step(goal), /call budget \(3\)/);
  assert.equal(guard.step({ id: 'g2', phase: 'active' }), null);
  assert.equal(withNotice({ structuredContent: { text: 'ok' } }, 'n').structuredContent.hostNotice, 'n');
  assert.deepEqual(withNotice({ content: [] }, 'n').content, [{ type: 'text', text: 'n' }]);
});

test('local compact schema collapses deep wide unions (goal verify conditions)', async () => {
  const { slimToolSchema } = await import('../src/harness-budget.mjs');
  const props = { source: { type: 'string', enum: ['block', 'inventory'] }, ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, { type: 'string' }])) };
  const schema = { type: 'object', properties: { add: { type: 'object', properties: { plan: { type: 'array', items: { type: 'object',
    properties: { do: { type: 'string' }, verify: { type: ['object', 'array', 'null'], required: ['source'], properties: props, items: { type: 'object', required: ['source'], properties: props } } } } } } } } };
  const verify = slimToolSchema(schema).properties.add.properties.plan.items.properties.verify;
  const collapsed = { type: 'object', properties: { source: props.source }, required: ['source'], additionalProperties: true };
  assert.deepEqual(verify, { ...collapsed, type: ['object', 'array', 'null'], items: collapsed });
});

test('fallback movement detector and compact schema match the core when available', async t => {
  const core = await import('agent-mc-world/client');
  if (typeof core.MovementProgress !== 'function') return t.skip('installed agent-mc-world predates MovementProgress');
  const { MovementProgressFallback } = await import('../src/harness-budget.mjs');
  const a = new core.MovementProgress(), b = new MovementProgressFallback();
  for (let i = 0; i < 9; i++) { const steps = [{ skill: 'goto', at: [i * 5 % 20, 67, i * 3 % 15] }]; assert.deepEqual(a.record(steps), b.record(steps)); }
});

test('chat guard refunds a line whose call was rejected', async () => {
  const { ChatGuard } = await import('../src/harness-budget.mjs');
  let t = 0; const g = new ChatGuard({ maxPublicLines: 4, minIntervalMs: 20000 }, () => t);
  const say = { steps: [{ skill: 'chat', text: 'hi' }] };
  assert.equal(g.check('mc_do', say), null); g.refund();
  t = 1000; assert.equal(g.check('mc_do', say), null); assert.equal(g.sent, 1);
  g.refund(); g.refund(); assert.equal(g.sent, 0);
});

test('guard counts repeated look-arounds; compactFacts fallback matches core when available', async () => {
  const { GoalProgressGuard, MovementProgressFallback, compactFactsFallback } = await import('../src/harness-budget.mjs');
  const guard = new GoalProgressGuard({ progress: new MovementProgressFallback(), closeAfter: 8 });
  const goal = { id: 'g', phase: 'active' }; const out = [];
  for (let i = 0; i < 9; i++) out.push(guard.observe(goal, `[00:0${i}] 附近: 村民 3 at (${i}, 64, 2)`));
  assert.deepEqual(out.slice(0, 6), [{}, {}, {}, {}, {}, {}]);
  assert.match(out[6].notice, /宿主提示/); assert.match(out[8].close, /look-arounds/);
  const facts = { run: 'r', decisionStability: {}, observation: { at: 'T', position: { x: 1.26, y: 2, z: 3 }, health: 20 },
    parts: [{ key: 'clock', text: '{"n":1}', revision: 'x', original: 'y' }, { key: 'life', text: '' }] };
  assert.deepEqual(compactFactsFallback(facts), { run: 'r', at: 'T', position: [1.3, 2, 3], health: 20, clock: { n: 1 } });
  const core = await import('agent-mc-world/client');
  if (core.compactFacts) assert.deepEqual(core.compactFacts(facts), compactFactsFallback(facts));
});

test('event condenser fallback hides server noise and since() shows mostly new events', async () => {
  const { EventCondenser } = await import('../src/event-condenser-fallback.mjs');
  let cursor = 0; const ev = (text, type = 'mymc.chat') => ({ cursor: ++cursor, ts: '2026-10-20T00:45:05+08:00', type, text });
  const c = new EventCondenser();
  c.push([ev('[MC 登录消息] [MC_AUTH_LOGIN] 请先登录：/login 密码。'), ev('[MC 插件] [照片] 用 /mycli photo menu 选角度。'),
    ev('[Minecraft] ☾ 星灯夜巡 | 2:15 状态条进度为 75%。', 'mymc.event'), ev('[Minecraft] ☾ 星灯夜巡 | 1:30 状态条进度为 50%。', 'mymc.event'),
    ev('[MC 系统] MC_STATUS {"adventurerRank":"青铜 III","nextCommand":"/mycli guild join","downed":false}'), ev('[MC] ag_CorMy: 你好 Jojo')]);
  assert.deepEqual(c.view().map(e => e.text), ['[Minecraft] ☾ 星灯夜巡 | 1:30 状态条进度为 50%。', '[服务器状态] 青铜 III；下一步 /mycli guild join', '[MC] ag_CorMy: 你好 Jojo']);
  assert.deepEqual(c.since(6, 1).map(e => e.cursor), [6]);
  const core = await import('agent-mc-world/client');
  if (core.EventCondenser) { const k = new core.EventCondenser(); k.push(c.view()); assert.equal(k.view().length, 3); }
});

test('guard wording distinguishes repeated look-arounds from wandering', async () => {
  const { GoalProgressGuard, MovementProgressFallback } = await import('../src/harness-budget.mjs');
  const guard = new GoalProgressGuard({ progress: new MovementProgressFallback(), closeAfter: 8 });
  const goal = { id: 'g', phase: 'active' }; let last;
  for (let i = 0; i < 9; i++) last = guard.observe(goal, 'same view ' + i) ?? last;
  assert.match(last.close, /look-arounds/);
});

test('event clock uses the configured zone; no-notes player history merges into one line', async () => {
  const { compactEvents } = await import('../src/harness-budget.mjs');
  const out = compactEvents([{ cursor: 1, ts: '2026-10-19T17:17:34.000Z', type: 'x' }, { cursor: 2, ts: '2026-10-20T01:17:35+08:00', type: 'x' }], 10, 200, 'Asia/Shanghai');
  assert.deepEqual(out.map(e => e.at), ['01:17:34', '01:17:35']);
  const { EventCondenser } = await import('../src/event-condenser-fallback.mjs');
  const c = new EventCondenser(); let cursor = 0;
  for (const n of ['Goddess', 'ag_NEKO']) c.push([{ cursor: ++cursor, ts: 'T', type: 'mymc.memory', text: `[游戏玩家历史] 账号 ${n}；本地未找到该账号已绑定且未过期的关系笔记；这不证明初次见面。` }]);
  assert.deepEqual(c.view().map(e => e.text), ['[玩家历史] 无本地关系笔记：Goddess、ag_NEKO（不代表初次见面，可查 mymc_memory）']);
});


test('default maxGoalCalls is 80 for long autonomy headroom', async () => {
  const { DEFAULT_MAX_GOAL_CALLS, GoalProgressGuard, MovementProgressFallback } = await import('../src/harness-budget.mjs');
  assert.equal(DEFAULT_MAX_GOAL_CALLS, 80);
  const guard = new GoalProgressGuard({ progress: new MovementProgressFallback() });
  const goal = { id: 'g', phase: 'active' };
  for (let i = 0; i < 80; i++) assert.equal(guard.step(goal), null);
  assert.match(guard.step(goal), /call budget \(80\)/);
});

test('idle sneak/jump control spam nudges then closes without resetting like real work', async () => {
  const { GoalProgressGuard, MovementProgressFallback } = await import('../src/harness-budget.mjs');
  const guard = new GoalProgressGuard({ progress: new MovementProgressFallback({ window: 4 }), closeAfter: 6 });
  const goal = { id: 'g', phase: 'active' };
  const out = [];
  for (let i = 0; i < 6; i++) out.push(guard.action(goal, [{ skill: 'control', keys: ['sneak'], durationMs: 1500, mode: 'ground' }]));
  assert.match(out[3].notice, /sneak\/jump|宿主提示/);
  assert.match(out[5].close, /control-only/);
  // A real place resets the streak.
  assert.deepEqual(guard.action(goal, [{ skill: 'place', block: 'dirt', at: [1, 64, 1] }]), {});
  assert.deepEqual(guard.action(goal, [{ skill: 'control', keys: ['sneak'], durationMs: 500 }]), {});
});

test('craft sync refuses the next craft only while bag digest is still stale', async () => {
  const { CraftSyncGuard } = await import('../src/harness-budget.mjs');
  const g = new CraftSyncGuard();
  const bag = items => ({ inventory: items, observation: { inventory: items } });
  const craft = item => [{ skill: 'craft', item }];
  assert.equal(g.before(craft('oak_planks'), bag([{ name: 'oak_log', count: 1 }])), null);
  g.after(craft('oak_planks'), bag([{ name: 'oak_log', count: 1 }]), false); // lag: same bag
  assert.match(g.before(craft('stick'), bag([{ name: 'oak_log', count: 1 }])), /尚未变化/);
  g.noteFacts(bag([{ name: 'oak_planks', count: 4 }])); // synced
  assert.equal(g.before(craft('stick'), bag([{ name: 'oak_planks', count: 4 }])), null);
  g.after(craft('stick'), bag([{ name: 'oak_planks', count: 2 }, { name: 'stick', count: 4 }]), false); // already synced
  assert.equal(g.before(craft('wooden_pickaxe'), bag([{ name: 'oak_planks', count: 2 }, { name: 'stick', count: 4 }])), null);
});

test('survival hint fires below food threshold and respects config', async () => {
  const { survivalHint, DEFAULT_FOOD_THRESHOLD, withNotice } = await import('../src/harness-budget.mjs');
  assert.equal(DEFAULT_FOOD_THRESHOLD, 15);
  assert.equal(survivalHint({ food: 16 }), undefined);
  assert.match(survivalHint({ food: 13 }), /饥饿 13\/20/);
  assert.match(survivalHint({ observation: { food: 10 } }), /优先寻找可食用食物/);
  assert.equal(survivalHint({ food: 10 }, { foodThreshold: 8 }), undefined);
  assert.equal(survivalHint({ food: 10 }, { foodThreshold: 0 }), undefined);
  const merged = withNotice({ structuredContent: { text: 'ok', hostNotice: 'a' } }, 'b');
  assert.equal(merged.structuredContent.hostNotice, 'a\nb');
});
