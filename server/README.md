<!--
SPDX-License-Identifier: Apache-2.0
Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
-->
# AI Proxy (REFERENCE backend)

This is a **reference proxy** that lets the Perfume Recommender talk to a real Claude model
without ever putting an API key in the browser or the repository.

> **The demo does NOT need this server.** With `ai/config.js` → `AI_ENDPOINT = ""` (the default),
> the app uses a built-in deterministic **MockProvider** and works fully client-side.
> Deploy this proxy only when you want real LLM responses.

## Why a proxy?

**API keys must live server-side only.** A browser SPA cannot hold a secret — anything shipped
to the client is public. So the browser calls *this* proxy, and the proxy calls Claude using a
key that exists only in the server's environment (`ANTHROPIC_API_KEY`).

```
browser  ──POST /api/ai {task,payload}──▶  this proxy  ──messages.stream()──▶  Claude
   ▲                                            │  (holds ANTHROPIC_API_KEY,
   └────────────  text stream  ◀────────────────┘   never sent to the browser)
```

## Run (operator environment only — never in CI, never in this repo)

```bash
cd server
npm install                       # installs @anthropic-ai/sdk
cp .env.example .env              # then edit .env and put your real key in it
ANTHROPIC_API_KEY=YOUR_ANTHROPIC_API_KEY node index.mjs
# → AI proxy listening on http://localhost:8787  (POST /api/ai, model=claude-haiku-4-5)
```

### Cost / model env vars

| Var | Default | Meaning |
|-----|---------|---------|
| `AI_MODEL` | `claude-haiku-4-5` | Cost-first default. Raise to `claude-sonnet-5` / `claude-opus-5` for higher quality. |
| `AI_EFFORT` | `low` | Effort for Sonnet/Opus only (Haiku ignores thinking/effort). |
| `AI_RATE_PER_MIN` | `20` | Per-IP requests per minute; over → `429 {fallback:true}`. |
| `AI_MONTHLY_TOKEN_CAP` | `2000000` | Monthly token budget; over → `429 {fallback:true}`. |

**Cost-efficiency built in:** default **Haiku 4.5** (~$1/$5 per MTok), **prompt caching** on the per-task
system block, modest per-task `max_tokens` (~700), adaptive thinking/effort only on Sonnet/Opus (Haiku
rejects them → no 400s), and the rate-limit + token-budget guardrails above. On `429 {fallback:true}` the
frontend auto-falls back to the built-in mock, so the app never breaks (무인).

(Any process manager / `--env-file=.env` on Node 20+ / container secret works too — just make
sure the key arrives as an environment variable and never as source.)

## Wire the frontend to it

Set the endpoint in [`../ai/config.js`](../ai/config.js):

```js
export const AI_ENDPOINT = "http://localhost:8787/api/ai"; // or your deployed URL
```

The frontend posts `{ task, payload }` and streams the plain-text response. Task ids come from
[`../ai/ai.js`](../ai/ai.js) (`TASKS`): `consult`, `rationale`, `moment`.

## What it does

- `POST /api/ai` with `{ "task": "...", "payload": {...} }`
- Builds a Korean system prompt per task (sent as a cached `system` block) and calls
  `client.messages.stream({ model: AI_MODEL || "claude-haiku-4-5", max_tokens: ~700, system:[{…cache_control}], messages })`
  (adds `thinking`/`output_config.effort` only for non-Haiku models)
- Streams Claude's text deltas straight back to the browser (`text/plain; charset=utf-8`)
- CORS enabled (`ALLOW_ORIGIN`, default `*`; narrow it to your domain in production)

## Free unmanned deploy — Cloudflare Workers (무인)

For a **free, no-server-to-babysit** deploy, use the Worker variant [`worker.js`](./worker.js) +
[`wrangler.toml`](./wrangler.toml). It calls the Anthropic REST API
(`POST https://api.anthropic.com/v1/messages`) with the **same task routing, model, and prompt-caching
rules** as `index.mjs`, and returns the assistant text.

```bash
cd server
wrangler secret put ANTHROPIC_API_KEY   # key lives ONLY as a Worker secret — never in the repo
wrangler deploy                         # → https://perfume-recommender-ai.<you>.workers.dev
```

Then point the frontend at `https://…workers.dev/api/ai` in [`../ai/config.js`](../ai/config.js).
`AI_MODEL` / `AI_EFFORT` / `ALLOW_ORIGIN` can be set as `[vars]` in `wrangler.toml`; on any upstream
failure the Worker returns `429 {fallback:true}` so the frontend auto-falls back to the mock.

## Model

`claude-haiku-4-5` by default (cost-first). Streaming is used for the Node proxy; adaptive thinking
(`thinking: { type: "adaptive" }`) and `output_config.effort` are applied only for Sonnet/Opus, because
Haiku 4.5 rejects them (would 400). Set `AI_MODEL` (env / `wrangler.toml` var) to change tier — no code
edit needed.

## Security checklist

- **Never** commit a real key. `.env` is git-ignored; `.env.example` holds only a placeholder.
- Keep `ANTHROPIC_API_KEY` in the server environment, never in frontend code.
- Narrow `ALLOW_ORIGIN` to your deployed origin in production.
- Consider adding rate limiting / auth in front of this proxy before exposing it publicly.
