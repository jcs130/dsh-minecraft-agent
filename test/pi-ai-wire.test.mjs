import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('pi-ai sends explicit Qwen thinking-off, output budget and stable affinity to a loopback endpoint', async () => {
  const { stream } = await import(pathToFileURL(resolve(process.env.DSH_RUNTIME ?? '.',
    'node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js')));
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push({ body: JSON.parse(body), session: req.headers['x-litellm-session-id'] });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: ' + JSON.stringify({ id: 'offline', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } }) + '\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const model = { id: 'qwen-test', name: 'qwen-test', provider: 'offline-test', api: 'openai-completions',
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`, reasoning: true, input: ['text'], contextWindow: 262144, maxTokens: 6000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: { thinkingFormat: 'chat-template', chatTemplateKwargs: { enable_thinking: false }, maxTokensField: 'max_tokens' } };
    for (const reasoning of [false, true]) {
      const result = await stream({ ...model, reasoning }, { messages: [{ role: 'user', content: 'ping', timestamp: 0 }] },
        { apiKey: 'offline-test', maxTokens: 2000, headers: { 'x-litellm-session-id': 'offline-independent-session' } }).result();
      assert.notEqual(result.stopReason, 'error', result.errorMessage);
    }
    assert.equal(requests[0].body.chat_template_kwargs, undefined);
    assert.deepEqual(requests[1].body.chat_template_kwargs, { enable_thinking: false });
    assert.equal(requests[1].body.max_tokens, 2000);
    assert.equal(requests[1].session, 'offline-independent-session');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
