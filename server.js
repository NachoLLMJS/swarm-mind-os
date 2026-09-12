import express from 'express';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const AGENTS = ['SCANNER', 'RISK', 'ROUTER', 'SENTINEL', 'EXECUTOR'];
const RESPONSE_FIELDS = ['scanner', 'risk', 'router', 'sentinel', 'executor', 'answer'];
const responseSchema = {
  type: 'object',
  properties: {
    scanner: { type: 'string' },
    risk: { type: 'string' },
    router: { type: 'string' },
    sentinel: { type: 'string' },
    executor: { type: 'string' },
    answer: { type: 'string' }
  },
  required: ['scanner', 'risk', 'router', 'sentinel', 'executor', 'answer'],
  additionalProperties: false
};

function extractText(data) {
  if (typeof data.output_text === 'string') return data.output_text;
  return (data.output || []).flatMap(item => item.content || []).map(item => item.text || '').join('');
}

function validAgentResult(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === RESPONSE_FIELDS.length
    && RESPONSE_FIELDS.every(field => typeof value[field] === 'string' && value[field].trim() && value[field].length <= 4000);
}

async function consumeRateLimit({ ip, now, env, fetchImpl, windows }) {
  if (env.VERCEL) {
    const url = (env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
    const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return { status: 503, error: 'AI_PROTECTION_NOT_CONFIGURED', message: 'Protected AI access is not configured on the server.' };
    const identity = createHash('sha256').update(ip).digest('hex').slice(0, 32);
    const minute = Math.floor(now / 60_000);
    const day = Math.floor(now / 86_400_000);
    const ipKey = `swarm-mind:rate:ip:${identity}:${minute}`;
    const globalKey = `swarm-mind:rate:global:${minute}`;
    const dailyKey = `swarm-mind:rate:daily:${day}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    try {
      const response = await fetchImpl(`${url}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify([
          ['INCR', ipKey], ['EXPIRE', ipKey, '120'],
          ['INCR', globalKey], ['EXPIRE', globalKey, '120'],
          ['INCR', dailyKey], ['EXPIRE', dailyKey, '172800']
        ])
      });
      if (!response.ok) throw new Error('rate store rejected request');
      const data = await response.json();
      if (!Array.isArray(data) || data.length !== 6) throw new Error('invalid rate store response');
      const counts = [data?.[0]?.result, data?.[2]?.result, data?.[4]?.result];
      const expirations = [data?.[1]?.result, data?.[3]?.result, data?.[5]?.result];
      if (counts.some(count => typeof count !== 'number' || !Number.isInteger(count) || count < 1) || expirations.some(result => typeof result !== 'number' || result !== 1)) throw new Error('invalid rate store response');
      return counts[0] > 20 || counts[1] > 60 || counts[2] > 500
        ? { status: 429, error: 'RATE_LIMITED', message: 'Swarm request limit reached. Try again shortly.' }
        : null;
    } catch {
      return { status: 503, error: 'AI_PROTECTION_UNAVAILABLE', message: 'Protected AI access is temporarily unavailable.' };
    } finally {
      clearTimeout(timeout);
    }
  }

  const recent = (windows.get(ip) || []).filter(t => now - t < 60_000);
  if (recent.length >= 20) return { status: 429, error: 'RATE_LIMITED', message: 'Swarm request limit reached. Try again shortly.' };
  recent.push(now);
  windows.set(ip, recent);
  return null;
}

export async function createApp({ fetchImpl = fetch, env = process.env, development = false } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (env.VERCEL) app.set('trust proxy', 1);
  app.use(express.json({ limit: '24kb' }));
  app.use((req, res, next) => req.path.startsWith('/.env') ? res.status(404).end() : next());

  const windows = new Map();
  let requestsSinceSweep = 0;
  app.post('/api/swarm', async (req, res) => {
    const ip = req.ip || 'local';
    const now = Date.now();
    if (++requestsSinceSweep >= 100 || windows.size > 5000) {
      for (const [key, times] of windows) {
        const active = times.filter(t => now - t < 60_000);
        if (active.length) windows.set(key, active);
        else windows.delete(key);
      }
      requestsSinceSweep = 0;
    }
    const apiKey = env.OPENAI_API_KEY?.trim();
    if (!apiKey) return res.status(503).json({ error: 'AI_NOT_CONFIGURED', message: 'OpenAI is not configured on the server.' });

    const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 1200) : '';
    if (!message) return res.status(400).json({ error: 'INVALID_MESSAGE', message: 'Write a message for the swarm.' });

    const rawHistory = req.body?.history;
    if (rawHistory !== undefined && !Array.isArray(rawHistory)) return res.status(400).json({ error: 'INVALID_HISTORY', message: 'History must be a list.' });
    if ((rawHistory || []).some(item => !item || typeof item !== 'object' || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string')) return res.status(400).json({ error: 'INVALID_HISTORY', message: 'History entries must contain a valid role and text.' });
    const history = (rawHistory || []).slice(-8).map(item => ({
      role: item?.role === 'assistant' ? 'assistant' : 'user',
      content: typeof item?.content === 'string' ? item.content.trim().slice(0, 1200) : ''
    })).filter(item => item.content);

    if (req.body?.target !== undefined && typeof req.body.target !== 'string') return res.status(400).json({ error: 'INVALID_TARGET', message: 'Token target must be text.' });
    const rawTarget = typeof req.body?.target === 'string' ? req.body.target.trim() : '';
    if (rawTarget && !/^0x[a-fA-F0-9]{40}$/.test(rawTarget)) return res.status(400).json({ error: 'INVALID_TARGET', message: 'Token target must be a valid address.' });
    const target = rawTarget || 'not selected';

    const rawAmount = req.body?.amount;
    const hasAmount = rawAmount !== undefined && rawAmount !== null && String(rawAmount).trim() !== '';
    if (hasAmount && !['string', 'number'].includes(typeof rawAmount)) return res.status(400).json({ error: 'INVALID_AMOUNT', message: 'Amount must be a number.' });
    if (typeof rawAmount === 'string' && hasAmount && !/^(?:\d+\.?\d*|\.\d+)$/.test(rawAmount.trim())) return res.status(400).json({ error: 'INVALID_AMOUNT', message: 'Amount must use decimal notation.' });
    const numericAmount = hasAmount ? Number(rawAmount) : NaN;
    if (hasAmount && (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > 1_000_000)) return res.status(400).json({ error: 'INVALID_AMOUNT', message: 'Amount must be finite and within the supported research range.' });
    const amount = hasAmount ? `${numericAmount} ETH` : 'not selected';

    const limitError = await consumeRateLimit({ ip, now, env, fetchImpl, windows });
    if (limitError) return res.status(limitError.status).json({ error: limitError.error, message: limitError.message });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const upstream = await fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
        body: JSON.stringify({
          model: env.OPENAI_MODEL || 'gpt-4.1-mini',
          instructions: `You are the reasoning layer for Swarm Mind OS, a Robinhood Chain research interface. Produce a compact internal review from five agents and one useful final answer. SCANNER identifies facts and missing inputs. RISK highlights uncertainty, scams and security concerns. ROUTER suggests read-only research paths and comparisons. SENTINEL prevents unsafe actions, never requests private keys or seed phrases, and clearly labels unverified claims. EXECUTOR states the safest next user-approved step. Never claim that a token is safe, never guarantee profit, and never execute or fabricate a transaction. The interface may later connect deterministic tools, but you currently provide research only. Current token target: ${target}. Intended spend: ${amount}.`,
          input: [...history, { role: 'user', content: message }],
          max_output_tokens: 900,
          text: { format: { type: 'json_schema', name: 'swarm_response', strict: true, schema: responseSchema } }
        })
      });
      const data = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        const code = upstream.status === 401 ? 'OPENAI_AUTH' : upstream.status === 429 ? 'OPENAI_LIMIT' : 'OPENAI_ERROR';
        return res.status(upstream.status === 429 ? 429 : 502).json({ error: code, message: code === 'OPENAI_AUTH' ? 'The server API key was rejected.' : code === 'OPENAI_LIMIT' ? 'OpenAI rate limit or quota reached.' : 'OpenAI could not complete the swarm response.' });
      }
      const text = extractText(data);
      let result;
      try { result = JSON.parse(text); } catch { return res.status(502).json({ error: 'INVALID_AI_RESPONSE', message: 'The swarm returned an invalid structured response.' }); }
      if (!validAgentResult(result)) return res.status(502).json({ error: 'INVALID_AI_RESPONSE', message: 'The swarm returned an invalid structured response.' });
      return res.json({ agents: AGENTS.map(name => ({ name, text: result[name.toLowerCase()] })), answer: result.answer, model: data.model || env.OPENAI_MODEL || 'gpt-4.1-mini' });
    } catch (error) {
      return res.status(502).json({ error: error?.name === 'AbortError' ? 'OPENAI_TIMEOUT' : 'OPENAI_UNAVAILABLE', message: error?.name === 'AbortError' ? 'The swarm timed out.' : 'The AI service is currently unavailable.' });
    } finally { clearTimeout(timeout); }
  });

  if (development) {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(join(here, 'dist')));
    app.use((_req, res) => res.sendFile(join(here, 'dist', 'index.html')));
  }
  return app;
}
