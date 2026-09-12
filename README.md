# SWARM MIND OS

A Three.js Robinhood Chain research interface with five AI agents: Scanner, Risk, Router, Sentinel and Executor.

Official X account: https://x.com/SwarmmindOS

## Local development

1. Copy `.env.example` to `.env.local`.
2. Add `OPENAI_API_KEY` locally. Never commit this file.
3. Run `npm install` and `npm run dev`.
4. Open `http://127.0.0.1:4178`.

## Security boundary

The OpenAI credential is read only by the Node/serverless API. Browser code calls `/api/swarm` and never receives the credential. The interface provides research only: it has no wallet connection and cannot authorize or submit transactions.

Production AI requests fail closed unless a durable Upstash/Vercel KV REST rate store is configured with `KV_REST_API_URL` and `KV_REST_API_TOKEN`. The server enforces per-IP, global minute, and global daily request ceilings; keep provider spend limits enabled as an additional cost boundary.

## Verification

```bash
npm test
npm run build
```
