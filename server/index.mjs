// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// server/index.mjs — REFERENCE 백엔드 프록시 (운영자가 자신의 키로 배포).
//
// ┌────────────────────────────────────────────────────────────────────────┐
// │  ⚠️  이 저장소/CI 에서는 절대 실행하지 않는다. API 키를 넣고 돌리지 말 것.   │
// │  운영자가 자신의 인프라에 배포하고, ANTHROPIC_API_KEY 를 서버 환경변수로만   │
// │  주입한다. 키는 브라우저·프런트엔드·저장소 어디에도 존재하지 않는다.         │
// └────────────────────────────────────────────────────────────────────────┘
//
// 역할: 프런트엔드의 POST /api/ai  {task, payload}  요청을 받아
//       Claude(claude-opus-5)로 스트리밍 호출하고, 텍스트 델타를 그대로 흘려보낸다.
//
// 실행(운영자 환경에서만):
//   cd server && npm install
//   ANTHROPIC_API_KEY=YOUR_ANTHROPIC_API_KEY node index.mjs

import http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';

const PORT = Number(process.env.PORT) || 8787;
// CORS 허용 오리진(콤마 구분). 기본은 로컬 정적 서버. 운영 시 배포 도메인으로 좁힌다.
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const MODEL = 'claude-opus-5';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ---------- 태스크별 프롬프트 구성 ----------
// payload 는 프런트가 recommender/데이터에서 뽑아 보낸 값이라 서버는 DB가 필요 없다.
function buildPrompt(task, payload = {}) {
  const base = '당신은 세심하고 우아한 한국어 향 컨설턴트입니다. 과장 없이 따뜻하고 구체적으로, 존댓말로 답합니다. 데이터에 없는 사실은 지어내지 않습니다.';

  if (task === 'consult') {
    return {
      system: `${base} 사용자의 자연어 취향 설명과 후보 향수 목록(JSON)을 받아, 가장 잘 맞는 3개를 이유와 함께 추천합니다.`,
      user: `사용자 취향: ${String(payload.query || '')}\n\n후보 향수(JSON):\n${JSON.stringify(payload.perfumes || [], null, 0)}`,
    };
  }
  if (task === 'rationale') {
    return {
      system: `${base} 규칙 기반 매칭 점수(0~100)와 추천 결과를 받아, 왜 이 향들이 어울리는지 점수를 향의 언어로 풀어 서술합니다.`,
      user: `설문 응답(JSON):\n${JSON.stringify(payload.answers || {}, null, 0)}\n\n추천 결과(점수·이유 포함, JSON):\n${JSON.stringify(payload.results || [], null, 0)}`,
    };
  }
  if (task === 'moment') {
    return {
      system: `${base} 향수 하나를 받아 "이 향이 어울리는 순간"을 2~3문장의 짧고 감각적인 문구로 씁니다.`,
      user: `향수(JSON):\n${JSON.stringify(payload.perfume || {}, null, 0)}`,
    };
  }
  return null;
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1_000_000) reject(new Error('요청 본문이 너무 큽니다'));
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method !== 'POST' || !req.url.startsWith('/api/ai')) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }

  let body;
  try { body = await readJson(req); }
  catch (e) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Bad Request: ' + e.message); return; }

  const prompt = buildPrompt(body.task, body.payload);
  if (!prompt) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Bad Request: unknown task'); return; }

  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache',
  });

  try {
    // 스트리밍: 긴 입력/출력에서도 HTTP 타임아웃을 피하고 토큰을 즉시 흘려보낸다.
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
    });
    stream.on('text', (delta) => res.write(delta));
    await stream.finalMessage();
    res.end();
  } catch (err) {
    // 헤더는 이미 전송됐을 수 있으므로 스트림 말미에 오류 표시만 덧붙인다.
    if (!res.writableEnded) res.end(`\n[AI 오류] ${err && err.message ? err.message : err}`);
  }
});

server.listen(PORT, () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY 가 설정되지 않았습니다. 이 프록시는 키 없이는 동작하지 않습니다.');
  }
  console.log(`AI proxy listening on http://localhost:${PORT}  (POST /api/ai, model=${MODEL})`);
});
