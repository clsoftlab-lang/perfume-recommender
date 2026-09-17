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
# → AI proxy listening on http://localhost:8787  (POST /api/ai, model=claude-opus-5)
```

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
- Builds a Korean system prompt per task and calls
  `client.messages.stream({ model: "claude-opus-5", max_tokens: 2048, thinking: { type: "adaptive" }, system, messages })`
- Streams Claude's text deltas straight back to the browser (`text/plain; charset=utf-8`)
- CORS enabled (`ALLOW_ORIGIN`, default `*`; narrow it to your domain in production)

## Model

`claude-opus-5` with adaptive thinking (`thinking: { type: "adaptive" }`) and streaming — the
current defaults for the Anthropic SDK. Change the `MODEL` constant in `index.mjs` if you need a
different tier.

## Security checklist

- **Never** commit a real key. `.env` is git-ignored; `.env.example` holds only a placeholder.
- Keep `ANTHROPIC_API_KEY` in the server environment, never in frontend code.
- Narrow `ALLOW_ORIGIN` to your deployed origin in production.
- Consider adding rate limiting / auth in front of this proxy before exposing it publicly.
