// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// server/worker.js — Cloudflare Workers 변형 (무인·무서버·프리티어).
//
// index.mjs 와 동일한 태스크 라우팅 / 모델 / 프롬프트 캐싱 규칙을 그대로 쓰되,
// Node SDK 대신 Anthropic REST(POST /v1/messages)를 직접 호출한다.
// 서버를 직접 돌보지 않아도 되는 무료 배포 경로.
//
// 키는 Worker 시크릿으로만 존재한다(브라우저·저장소 어디에도 없음):
//   wrangler secret put ANTHROPIC_API_KEY
// 배포:
//   cd server && wrangler deploy
// 그런 다음 ../ai/config.js 의 AI_ENDPOINT 를 이 워커 URL(+ /api/ai)로 설정.

// ---------- 태스크별 프롬프트 (index.mjs 와 동일 규칙) ----------
function buildPrompt(task, payload = {}) {
  const base = '당신은 세심하고 우아한 한국어 향 컨설턴트입니다. 과장 없이 따뜻하고 구체적으로, 존댓말로 답합니다. 데이터에 없는 사실은 지어내지 않습니다.';

  if (task === 'consult') {
    return {
      system: `${base} 사용자의 자연어 취향 설명과 후보 향수 목록(JSON)을 받아, 가장 잘 맞는 3개를 이유와 함께 추천합니다.`,
      user: `사용자 취향: ${String(payload.query || '')}\n\n후보 향수(JSON):\n${JSON.stringify(payload.perfumes || [], null, 0)}`,
      maxTokens: 700,
    };
  }
  if (task === 'rationale') {
    return {
      system: `${base} 규칙 기반 매칭 점수(0~100)와 추천 결과를 받아, 왜 이 향들이 어울리는지 점수를 향의 언어로 풀어 서술합니다.`,
      user: `설문 응답(JSON):\n${JSON.stringify(payload.answers || {}, null, 0)}\n\n추천 결과(점수·이유 포함, JSON):\n${JSON.stringify(payload.results || [], null, 0)}`,
      maxTokens: 700,
    };
  }
  if (task === 'moment') {
    return {
      system: `${base} 향수 하나를 받아 "이 향이 어울리는 순간"을 2~3문장의 짧고 감각적인 문구로 씁니다.`,
      user: `향수(JSON):\n${JSON.stringify(payload.perfume || {}, null, 0)}`,
      maxTokens: 400,
    };
  }
  return null;
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': (env && env.ALLOW_ORIGIN) || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    if (request.method !== 'POST' || !url.pathname.startsWith('/api/ai')) {
      return new Response('Not Found', { status: 404, headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } });
    }

    let body;
    try { body = await request.json(); }
    catch { return new Response('Bad Request', { status: 400, headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } }); }

    const prompt = buildPrompt(body.task, body.payload);
    if (!prompt) {
      return new Response('Bad Request: unknown task', { status: 400, headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } });
    }

    // 비용 우선 기본 모델. AI_MODEL 로 상향 가능(claude-sonnet-5 / claude-opus-5).
    const MODEL = (env && env.AI_MODEL) || 'claude-haiku-4-5';
    const IS_HAIKU = MODEL.startsWith('claude-haiku');

    const payload = {
      model: MODEL,
      max_tokens: prompt.maxTokens || 700,
      // 프롬프트 캐싱: 안정적인 system 을 캐시 블록으로 → 반복 호출 시 비용 절감.
      system: [{ type: 'text', text: prompt.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt.user }],
    };
    if (!IS_HAIKU) {
      // Haiku 4.5 는 adaptive thinking / effort 를 받지 않는다(보내면 400). 그 외 모델만 적용.
      payload.thinking = { type: 'adaptive' };
      payload.output_config = { effort: (env && env.AI_EFFORT) || 'low' };
    }

    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!r.ok) {
        // 어떤 이유로든 실패 → 프런트가 mock 으로 폴백하도록 429 {fallback:true}.
        return new Response(JSON.stringify({ fallback: true }), {
          status: 429, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
        });
      }

      const data = await r.json();
      const text = ((data && data.content) || [])
        .filter((b) => b && b.type === 'text')
        .map((b) => b.text)
        .join('');
      return new Response(text, { status: 200, headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } });
    } catch {
      return new Response(JSON.stringify({ fallback: true }), {
        status: 429, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
  },
};
