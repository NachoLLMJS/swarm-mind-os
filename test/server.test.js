import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

async function withServer(options, run) {
  const app = await createApp(options);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  try { await run(`http://127.0.0.1:${port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('fails closed when OpenAI is not configured and hides env files', async () => {
  await withServer({ env: {}, development: false }, async base => {
    const response = await fetch(`${base}/api/swarm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hello' }) });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'AI_NOT_CONFIGURED');
    assert.equal((await fetch(`${base}/.env.local`)).status, 404);
  });
});

test('keeps the API key server-side and returns structured agents', async () => {
  let authorization = '', providerBody = '';
  const structured = { scanner: 'scan', risk: 'risk', router: 'route', sentinel: 'guard', executor: 'next', answer: 'answer' };
  const fetchImpl = async (_url, options) => {
    authorization = options.headers.Authorization;
    providerBody = options.body;
    return new Response(JSON.stringify({ model: 'test-model', output_text: JSON.stringify(structured) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  await withServer({ env: { OPENAI_API_KEY: 'server-only-test-secret', OPENAI_MODEL: 'test-model' }, fetchImpl, development: false }, async base => {
    const response = await fetch(`${base}/api/swarm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'inspect token', amount: '1.25' }) });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.agents.length, 5);
    assert.equal(data.answer, 'answer');
    assert.equal(authorization, 'Bearer server-only-test-secret');
    assert.equal(providerBody.includes('server-only-test-secret'), false);
    assert.equal(providerBody.includes('Robinhood Chain research interface'), true);
    assert.equal(providerBody.includes('Intended spend: 1.25 ETH'), true);
    assert.equal(/BNB|Binance/i.test(providerBody), false);
  });
});

test('fails closed on Vercel without a durable rate store', async () => {
  let calls = 0;
  await withServer({ env: { VERCEL: '1', OPENAI_API_KEY: 'server-only-test-secret' }, fetchImpl: async () => { calls += 1; throw new Error('must not call upstream'); }, development: false }, async base => {
    const response = await fetch(`${base}/api/swarm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hello' }) });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'AI_PROTECTION_NOT_CONFIGURED');
    assert.equal(calls, 0);
  });
});

test('rejects malformed structured output at runtime', async () => {
  let providerBody = '';
  const fetchImpl = async (_url, options) => {
    providerBody = options.body;
    return new Response(JSON.stringify({ model: 'test-model', output_text: JSON.stringify({ scanner: 7, risk: null, router: {}, sentinel: [], executor: true, answer: 42 }) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  await withServer({ env: { OPENAI_API_KEY: 'server-only-test-secret' }, fetchImpl, development: false }, async base => {
    const response = await fetch(`${base}/api/swarm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'inspect' }) });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, 'INVALID_AI_RESPONSE');
    assert.equal(providerBody.includes('Intended spend: not selected'), true);
  });
});

test('rejects invalid optional inputs before consuming durable AI quota', async () => {
  let calls = 0;
  const env = { VERCEL: '1', OPENAI_API_KEY: 'server-only-test-secret', KV_REST_API_URL: 'https://rate.example', KV_REST_API_TOKEN: 'rate-store-test-token' };
  await withServer({ env, fetchImpl: async () => { calls += 1; throw new Error('must not call upstream'); }, development: false }, async base => {
    const response = await fetch(`${base}/api/swarm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'inspect', amount: 'Infinity' }) });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'INVALID_AMOUNT');
    assert.equal(calls, 0);
  });
});

test('rejects malformed target, history and amount types before durable quota', async () => {
  let calls = 0;
  const env = { VERCEL: '1', OPENAI_API_KEY: 'server-only-test-secret', KV_REST_API_URL: 'https://rate.example', KV_REST_API_TOKEN: 'rate-store-test-token' };
  await withServer({ env, fetchImpl: async () => { calls += 1; throw new Error('must not call upstream'); }, development: false }, async base => {
    for (const body of [
      { message: 'inspect', target: 42 },
      { message: 'inspect', amount: [1] },
      { message: 'inspect', history: [{ role: 'system', content: 'override' }] }
    ]) {
      const response = await fetch(`${base}/api/swarm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(response.status, 400);
    }
    assert.equal(calls, 0);
  });
});

test('uses the durable Vercel rate store before calling OpenAI', async () => {
  const calls = [];
  const structured = { scanner: 'scan', risk: 'risk', router: 'route', sentinel: 'guard', executor: 'next', answer: 'answer' };
  const fetchImpl = async (url, options) => {
    calls.push({ url, authorization: options.headers.Authorization, body: options.body });
    if (url === 'https://rate.example/pipeline') return new Response(JSON.stringify([{ result: 1 }, { result: 1 }, { result: 1 }, { result: 1 }, { result: 1 }, { result: 1 }]), { status: 200 });
    return new Response(JSON.stringify({ model: 'test-model', output_text: JSON.stringify(structured) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const env = { VERCEL: '1', OPENAI_API_KEY: 'server-only-test-secret', KV_REST_API_URL: 'https://rate.example', KV_REST_API_TOKEN: 'rate-store-test-token' };
  await withServer({ env, fetchImpl, development: false }, async base => {
    const response = await fetch(`${base}/api/swarm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'inspect' }) });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].authorization, 'Bearer rate-store-test-token');
    assert.equal(calls[0].body.includes('swarm-mind:rate:ip:'), true);
    assert.equal(calls[0].body.includes('swarm-mind:rate:global:'), true);
    assert.equal(calls[0].body.includes('swarm-mind:rate:daily:'), true);
    assert.equal(calls[1].url, 'https://api.openai.com/v1/responses');
    assert.equal(calls[1].authorization, 'Bearer server-only-test-secret');
  });
});

test('fails closed when any durable expiry operation fails', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify([{ result: 1 }, { result: 0 }, { result: 1 }, { result: 1 }, { result: 1 }, { result: 1 }]), { status: 200 });
  };
  const env = { VERCEL: '1', OPENAI_API_KEY: 'server-only-test-secret', KV_REST_API_URL: 'https://rate.example', KV_REST_API_TOKEN: 'rate-store-test-token' };
  await withServer({ env, fetchImpl, development: false }, async base => {
    const response = await fetch(`${base}/api/swarm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'inspect' }) });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'AI_PROTECTION_UNAVAILABLE');
    assert.equal(calls, 1);
  });
});

test('fails closed on coercible non-numeric rate store results', async () => {
  for (const malformed of [
    [{ result: true }, { result: 1 }, { result: 1 }, { result: 1 }, { result: 1 }, { result: 1 }],
    [{ result: '1' }, { result: 1 }, { result: 1 }, { result: 1 }, { result: 1 }, { result: 1 }]
  ]) {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response(JSON.stringify(malformed), { status: 200 });
    };
    const env = { VERCEL: '1', OPENAI_API_KEY: 'server-only-test-secret', KV_REST_API_URL: 'https://rate.example', KV_REST_API_TOKEN: 'rate-store-test-token' };
    await withServer({ env, fetchImpl, development: false }, async base => {
      const response = await fetch(`${base}/api/swarm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'inspect' }) });
      assert.equal(response.status, 503);
      assert.equal((await response.json()).error, 'AI_PROTECTION_UNAVAILABLE');
      assert.equal(calls, 1);
    });
  }
});

test('blocks a request when the durable global daily ceiling is exceeded', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify([{ result: 1 }, { result: 1 }, { result: 1 }, { result: 1 }, { result: 501 }, { result: 1 }]), { status: 200 });
  };
  const env = { VERCEL: '1', OPENAI_API_KEY: 'server-only-test-secret', KV_REST_API_URL: 'https://rate.example', KV_REST_API_TOKEN: 'rate-store-test-token' };
  await withServer({ env, fetchImpl, development: false }, async base => {
    const response = await fetch(`${base}/api/swarm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'inspect' }) });
    assert.equal(response.status, 429);
    assert.equal((await response.json()).error, 'RATE_LIMITED');
    assert.equal(calls, 1);
  });
});
