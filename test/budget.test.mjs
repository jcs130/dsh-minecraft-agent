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
  assert.deepEqual(selectTools(specs).map(t => t.name), ['mc_do', 'mc_tool_help']);
  assert.deepEqual(selectTools(specs, { include: ['mc_script'] }).map(t => t.name), ['mc_do', 'mc_script', 'mc_tool_help']);
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
  now += 30000; assert.equal(say('第二句'), null);
  now += 30000; assert.equal(say('第三句'), null);
  now += 30000; assert.match(say('第四句'), /上限（3 句，另留 1 句下线道别/);
  assert.equal(guard.check('mymc_goal', { done: 1 }), null);
  assert.equal(guard.takeGoodbye(), '我先下线啦，再见～');
  assert.equal(guard.takeGoodbye(), null);
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
});

test('wake filter: whispers/mentions/danger wake, other players chat and countdowns do not', async () => {
  const { classifyWakeFallback, WAKE_ACTIVE_GOAL } = await import('../src/harness-budget.mjs');
  const self = { selfNames: ['ag_jojo', 'Jojo'] };
  const chat = (text, uname, trigger = 'debounce') => ({ type: 'mymc.chat', text, trigger, ...(uname ? { meta: { uname } } : {}) });
  assert.equal(classifyWakeFallback(chat('[MC] ag_CorMy: 小鱼早呀~ 天亮了', 'ag_CorMy'), self).wake, false);
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
