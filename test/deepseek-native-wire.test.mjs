import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { modelToolSchema, measuredStream } from '../src/harness-bridge.mjs';

test('DSH built-in DeepSeek sends native Messages, session identity, thinking-off and compatible tuples', async () => {
  const require = createRequire(resolve(process.env.DSH_RUNTIME ?? '.', 'package.json'));
  const { DeepSeekAdapter, resolveAdapterOptions } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm-deepseek')));
  // A stock DSH installation does not own the game's dependencies. Resolve them
  // through the actual installed plugin profile, including isolated pnpm layouts.
  const profile = createRequire(resolve(process.env.MC_DSH_PROFILE ?? '.', 'package.json'));
  const pluginRequire = createRequire(profile.resolve('@jcs130/dsh-minecraft-agent/package.json'));
  const { default: Ajv2020 } = await import(pathToFileURL(createRequire(pluginRequire.resolve('agent-mc-world/package.json')).resolve('ajv/dist/2020.js')));
  const schema = { type: 'object', properties: { angles: { type: 'array', minItems: 3, maxItems: 3,
    items: [{ type: 'number', minimum: -90, maximum: 90 }, { type: 'number' }, { type: 'number', exclusiveMinimum: 0 }] } } };
  const translated = modelToolSchema(schema), validate = new Ajv2020({ strict: false }).compile(translated);
  assert.equal(validate({ angles: [0, 180, 2] }), true);
  assert.equal(validate({ angles: [91, 180, 2] }), false);
  assert.equal(validate({ angles: [0, 180, 0] }), false);
  const requests = [], metrics = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    requests.push({ path: req.url, body: JSON.parse(body), session: req.headers['x-deepseek-harness-session-id'] });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const event of [
      { type: 'message_start', message: { id: 'native-fixture', type: 'message', role: 'assistant', model: 'deepseek-flash',
        content: [], usage: { input_tokens: 20, cache_read_input_tokens: 80, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
      { type: 'message_stop' },
    ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const connection = resolveAdapterOptions({ baseURL: `http://127.0.0.1:${server.address().port}/anthropic`,
      thinking: 'disabled', reasoningEffort: 'off', maxTokens: 6000 });
    const adapter = new DeepSeekAdapter({ options: () => connection, resolveAuth: async () => ({ headers: { 'x-api-key': 'offline-fixture' } }),
      resolveUserId: () => 'offline-fixture', prepareExtensions: async () => ({ fields: {}, accept: async () => {} }) });
    const request = { provider: 'deepseek-official', model: 'deepseek-flash', sessionId: 'agent:persistent-session',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture' }] }], reasoningEffort: 'off', maxTokens: 2000,
      tools: [{ name: 'mc_fixture', description: 'Offline tool', parameters: translated }] };
    const chunks = [];
    for await (const chunk of measuredStream(request, () => adapter.stream(request), { report: x => metrics.push(x) }, request.model)) chunks.push(chunk);
    assert.equal(requests[0].path, '/anthropic/v1/messages');
    assert.equal(requests[0].session, 'agent:persistent-session');
    assert.deepEqual(requests[0].body.thinking, { type: 'disabled' });
    assert.equal(requests[0].body.max_tokens, 2000);
    assert.deepEqual(requests[0].body.tools[0].input_schema, translated);
    assert.equal(chunks.at(-1).reason.kind, 'stop');
    assert.equal(metrics.at(-1).inputTokens, 100);
    assert.equal(metrics.at(-1).cachedTokens, 80);
    assert.equal(metrics.at(-1).outcome, 'success');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
