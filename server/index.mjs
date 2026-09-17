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
//       Claude 로 스트리밍 호출하고, 텍스트 델타를 그대로 흘려보낸다.
//
// 무인·저비용 설계
// ----------------
//  · 비용 우선 기본 모델 claude-haiku-4-5 ($1/$5 per MTok). AI_MODEL 로 상향 가능.
//  · 프롬프트 캐싱: 태스크별 (안정적인) 시스템 프롬프트를 cache_control 블록으로 보내
//    반복 호출 시 캐시를 읽어 비용을 낮춘다.
//  · 출력 상한: 태스크별 modest max_tokens.
//  · 가드레일: IP당 분당 레이트 리밋 + 월 토큰 예산. 초과 시 429 {fallback:true}
//    → 프런트가 자동으로 내장 mock 으로 폴백(앱은 절대 멈추지 않는다, 무인).
//
// 실행(운영자 환경에서만):
//   cd server && npm install
//   ANTHROPIC_API_KEY=YOUR_ANTHROPIC_API_KEY node index.mjs
//   (선택) AI_MODEL=claude-sonnet-5  # 품질 상향 시

import http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';

const PORT = Number(process.env.PORT) || 8787;
// CORS 허용 오리진(콤마 구분). 기본은 로컬 정적 서버. 운영 시 배포 도메인으로 좁힌다.
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';

// 비용 우선 기본 모델. 품질을 높이려면 AI_MODEL=claude-sonnet-5 또는 claude-opus-5.
const MODEL = process.env.AI_MODEL || 'claude-haiku-4-5';
const EFFORT = process.env.AI_EFFORT || 'low';
// Haiku 4.5 는 adaptive thinking / effort 파라미터를 받지 않는다(보내면 400). 그래서 분기.
const IS_HAIKU = MODEL.startsWith('claude-haiku');

// ---------- 비용 가드레일 ----------
const RATE_PER_MIN = Number(process.env.AI_RATE_PER_MIN) || 20;         // IP당 분당 요청 상한
const MONTHLY_TOKEN_CAP = Number(process.env.AI_MONTHLY_TOKEN_CAP) || 2_000_000; // 월 토큰 예산

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ---------- 태스크별 프롬프트 구성 ----------
// payload 는 프런트가 recommender/데이터에서 뽑아 보낸 값이라 서버는 DB가 필요 없다.
// system 은 태스크마다 안정적이라 프롬프트 캐시 대상으로 삼는다.
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

// ---------- 레이트 리밋 (in-memory, IP당 슬라이딩 1분 창) ----------
const rateHits = new Map(); // ip -> { count, resetAt }
function allowRate(ip) {
  const now = Date.now();
  let e = rateHits.get(ip);
  if (!e || now > e.resetAt) { e = { count: 0, resetAt: now + 60_000 }; rateHits.set(ip, e); }
  e.count += 1;
  return e.count <= RATE_PER_MIN;
}

// ---------- 월 토큰 예산 (in-memory, 달 바뀌면 리셋) ----------
let usedTokens = 0;
let budgetMonth = monthKey();
function monthKey() { const d = new Date(); return `${d.getUTCFullYear()}-${d.getUTCMonth()}`; }
function underBudget() {
  const m = monthKey();
  if (m !== budgetMonth) { budgetMonth = m; usedTokens = 0; }
  return usedTokens < MONTHLY_TOKEN_CAP;
}
function addUsage(usage) {
  if (!usage) return;
  usedTokens += (usage.input_tokens || 0) + (usage.output_tokens || 0)
    + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
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

  // 가드레일: 레이트 리밋 / 월 예산 초과 → 429 {fallback:true} (프런트는 mock 으로 자동 폴백)
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket.remoteAddress || 'unknown';
  if (!allowRate(ip) || !underBudget()) {
    res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ fallback: true }));
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache',
  });

  try {
    // 요청 파라미터: 프롬프트 캐싱 + (Haiku 가 아닐 때만) adaptive thinking / effort.
    const params = {
      model: MODEL,
      max_tokens: prompt.maxTokens || 700,
      // 안정적인 시스템 프롬프트를 캐시 블록으로 → 반복 호출 시 캐시 읽기로 비용 절감.
      system: [{ type: 'text', text: prompt.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt.user }],
    };
    if (!IS_HAIKU) {
      params.thinking = { type: 'adaptive' };
      params.output_config = { effort: EFFORT };
    }

    // 스트리밍: 긴 입력/출력에서도 HTTP 타임아웃을 피하고 토큰을 즉시 흘려보낸다.
    const stream = client.messages.stream(params);
    stream.on('text', (delta) => res.write(delta));
    const final = await stream.finalMessage();
    addUsage(final && final.usage); // 최종 메시지 usage 를 월 예산에 누적
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
  console.log(`AI proxy listening on http://localhost:${PORT}  (POST /api/ai, model=${MODEL}, cap=${MONTHLY_TOKEN_CAP} tok/mo, rate=${RATE_PER_MIN}/min)`);
});
