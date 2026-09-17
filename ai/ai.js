// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// ai/ai.js — 플러그블 AI 레이어.
//
// 하나의 진입점 askAI(task, payload, {onToken}) 로 세 가지 AI 기능을 제공한다.
//
//   AI_ENDPOINT 가 비어 있으면(데모 기본값)  → 내장 MockProvider
//     · 추천 엔진(recommender.js)과 데이터를 그대로 재사용하는 결정론적 한국어 생성
//     · 서버·네트워크·API 키가 전혀 필요 없어 GitHub Pages 정적 배포로 바로 동작
//
//   AI_ENDPOINT 가 설정되면  → 백엔드 프록시로 POST {task, payload} 후 스트리밍 수신
//     · 실 LLM(Claude)은 server/ 프록시가 서버 측 키로 호출 (브라우저는 키를 모른다)
//
// 어느 경우든 onToken(chunk) 콜백으로 토큰이 흘러 들어오고, 최종 전체 문자열을 반환한다.

import {
  recommend, similarTo,
  FAMILY_LABELS, SEASON_LABELS, SITUATION_LABELS, GENDER_LABELS,
} from '../recommender.js';
import { AI_ENDPOINT } from './config.js';

// ---------- Task ids ----------
export const TASKS = Object.freeze({
  CONSULT: 'consult',    // (1) AI 향 컨설턴트 챗봇: 자연어 취향 → 향수 추천 + 이유
  RATIONALE: 'rationale', // (2) 취향 설문 → 추천 이유 서술 (매칭 점수를 우아한 문장으로)
  MOMENT: 'moment',       // (3) 상황별 향 추천 문구: "이 향이 어울리는 순간"
});

const TASK_SET = new Set(Object.values(TASKS));

/**
 * AI 호출 단일 진입점.
 * @param {string} task            TASKS 중 하나
 * @param {object} payload         태스크별 입력(아래 각 builder 참고)
 * @param {{onToken?:(chunk:string)=>void}} [opts]
 * @returns {Promise<string>}      생성된 전체 텍스트
 */
export async function askAI(task, payload = {}, { onToken } = {}) {
  if (!TASK_SET.has(task)) throw new Error(`알 수 없는 AI 태스크: ${task}`);
  const endpoint = String(AI_ENDPOINT || '').trim();
  if (!endpoint) return runMock(task, payload, onToken);

  // 무인(never-breaks) 원칙: 원격 프록시가 실패/429{fallback:true}/네트워크 오류면
  // 내장 mock 으로 자동 폴백한다. 앱은 어떤 경우에도 멈추지 않는다.
  try {
    return await runRemote(endpoint, task, payload, onToken);
  } catch (_err) {
    return runMock(task, payload, onToken);
  }
}

// ---------- 원격(실 LLM) : 백엔드 프록시 스트리밍 ----------
async function runRemote(endpoint, task, payload, onToken) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, payload }),
  });
  // 429 는 서버 가드레일(레이트/월 예산)의 폴백 신호({fallback:true}). 토큰을 흘리기 전에
  // 던져서 askAI 가 mock 으로 폴백하도록 한다(부분 스트림 중복 방지).
  if (res.status === 429) throw new Error('AI_FALLBACK_429');
  if (!res.ok) throw new Error(`AI 서버 오류: HTTP ${res.status}`);

  // 스트리밍 본문이 없으면 전체 텍스트로 폴백
  if (!res.body || typeof res.body.getReader !== 'function') {
    const text = await res.text();
    if (onToken && text) onToken(text);
    return text;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let full = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = dec.decode(value, { stream: true });
    if (chunk) { full += chunk; if (onToken) onToken(chunk); }
  }
  const tail = dec.decode();
  if (tail) { full += tail; if (onToken) onToken(tail); }
  return full;
}

// ---------- 내장 MockProvider (결정론적) ----------
async function runMock(task, payload, onToken) {
  const text = buildMock(task, payload);
  // onToken 이 있으면 살아있는 느낌으로 토막 전송(내용은 결정론적, 지연만 있음)
  if (onToken) await streamChunks(text, onToken);
  return text;
}

async function streamChunks(text, onToken) {
  const canDelay = typeof setTimeout === 'function';
  const step = 2;
  for (let i = 0; i < text.length; i += step) {
    onToken(text.slice(i, i + step));
    if (canDelay) await new Promise((r) => setTimeout(r, 12));
  }
}

function buildMock(task, payload) {
  switch (task) {
    case TASKS.CONSULT: return buildConsult(payload);
    case TASKS.RATIONALE: return buildRationale(payload);
    case TASKS.MOMENT: return buildMoment(payload);
    default: throw new Error(`알 수 없는 AI 태스크: ${task}`);
  }
}

// ---------- 공용 파서: 자연어 취향 → 설문 응답 ----------
// app.js 도 이 함수를 재사용해 챗봇 결과 카드를 렌더한다(단일 진실원천).
/**
 * @param {string} query 자연어 취향/상황 서술
 * @returns {{families:string[], season:string, situation:string, gender:string, budget:number}}
 */
export function parseTasteQuery(query) {
  const q = String(query || '').toLowerCase();
  const pick = (labels) => Object.entries(labels)
    .filter(([k, v]) => q.includes(k) || q.includes(String(v).toLowerCase()))
    .map(([k]) => k);

  const families = pick(FAMILY_LABELS);
  const season = pick(SEASON_LABELS)[0] || '';
  const situation = pick(SITUATION_LABELS)[0] || '';

  let gender = '';
  for (const [k, v] of Object.entries(GENDER_LABELS)) {
    if (k !== 'unisex' && (q.includes(k) || q.includes(v))) { gender = k; break; }
  }

  // 예산: "15만", "150000원", "20만원" 등
  let budget = 0;
  const man = q.match(/(\d+)\s*만/);
  const won = q.match(/(\d[\d,]{3,})\s*원?/);
  if (man) budget = Number(man[1]) * 10000;
  else if (won) budget = Number(won[1].replace(/,/g, ''));

  return { families, season, situation, gender, budget };
}

const koFams = (fams) => (fams || []).map((f) => FAMILY_LABELS[f] || f).join('·');

// ---------- (1) 챗봇 컨설턴트 ----------
function buildConsult({ query, perfumes, limit = 3 } = {}) {
  const q = String(query || '').trim();
  if (!q) return '어떤 향을 원하시는지 한 문장으로 들려주세요. 예: "여름 데이트에 어울리는 상큼한 시트러스, 15만원 이하".';

  const answers = parseTasteQuery(q);
  const list = Array.isArray(perfumes) ? perfumes : [];
  const picks = list.length ? recommend(list, answers, { limit }) : [];

  const detected = [];
  if (answers.families.length) detected.push(`${koFams(answers.families)} 계열`);
  if (answers.season) detected.push(`${SEASON_LABELS[answers.season]} 계절`);
  if (answers.situation) detected.push(`${SITUATION_LABELS[answers.situation]} 상황`);
  if (answers.gender) detected.push(`${GENDER_LABELS[answers.gender]} 타겟`);
  if (answers.budget) detected.push(`예산 ₩${answers.budget.toLocaleString('ko-KR')} 이내`);

  const lines = [];
  lines.push(`말씀해 주신 "${q}", 향의 언어로 읽어봤어요.`);
  lines.push(detected.length
    ? `핵심은 ${detected.join(', ')}으로 정리돼요. 이 결에 가장 가까운 향을 골라봤습니다.`
    : `구체적인 계열·계절·상황이 뚜렷하진 않아, 두루 잘 어울리는 향으로 추려봤어요.`);
  lines.push('');

  if (!picks.length) {
    lines.push('지금은 추천할 후보 데이터가 없네요. 잠시 후 다시 시도해 주세요.');
    return lines.join('\n');
  }

  picks.forEach((p, i) => {
    const why = p.reasons && p.reasons.length ? p.reasons.join(', ') : '전반적인 균형이 좋아요';
    lines.push(`${i + 1}. ${p.name} · ${p.brand} — ${koFams(p.families)} 계열. ${why}. (매칭 ${p.score}점, 평점 ★${p.rating})`);
  });

  lines.push('');
  const top = picks[0];
  lines.push(`가장 먼저 권해드리는 건 ${top.name}이에요. ${topNoteLine(top)} 마음이 가는 이름을 눌러 노트 피라미드까지 살펴보시길 권해요.`);
  return lines.join('\n');
}

// ---------- (2) 설문 → 추천 이유 서술 ----------
function buildRationale({ answers, results } = {}) {
  const a = answers || {};
  const picks = Array.isArray(results) ? results.slice(0, 3) : [];
  if (!picks.length) return '아직 추천 결과가 없어요. 설문을 먼저 완료해 주세요.';

  const wanted = [];
  if (a.families && a.families.length) wanted.push(`${koFams(a.families)}의 결`);
  if (a.situation) wanted.push(`${SITUATION_LABELS[a.situation] || a.situation}의 순간`);
  if (a.season) wanted.push(`${SEASON_LABELS[a.season] || a.season}의 공기`);

  const lines = [];
  lines.push(wanted.length
    ? `당신이 그린 취향은 ${wanted.join(', ')}이었어요. 매칭 점수를 향의 문장으로 풀어드릴게요.`
    : `열어두신 취향에 맞춰, 두루 어울리는 향을 점수와 함께 풀어드릴게요.`);
  lines.push('');

  const top = picks[0];
  const strong = strongestDimension(top.breakdown);
  lines.push(`1순위 ${top.name}(${top.brand})은 ${top.score}점으로 가장 가깝게 맞았어요. ${dimensionPhrase(strong)} ${top.reasons && top.reasons.length ? '특히 ' + top.reasons.join(', ') + '이 결정적이었습니다.' : ''}`.trim());

  if (picks[1]) {
    const p = picks[1];
    lines.push(`이어서 ${p.name}(${p.score}점)은 ${koFams(p.families)}의 인상이 취향과 겹쳐, 기분을 바꾸고 싶은 날의 대안으로 좋아요.`);
  }
  if (picks[2]) {
    const p = picks[2];
    lines.push(`${p.name}(${p.score}점)까지 곁에 두면, 같은 취향 안에서도 계절과 상황에 따라 골라 쓰는 작은 컬렉션이 완성됩니다.`);
  }

  lines.push('');
  lines.push('점수는 계열(40)·계절(20)·상황(20)·예산(15)·성별(5)의 가중 합이며, 답하지 않은 항목은 중립으로 처리돼 순위를 왜곡하지 않아요.');
  return lines.join('\n');
}

// ---------- (3) 상황별 향 추천 문구 ----------
function buildMoment({ perfume } = {}) {
  const p = perfume;
  if (!p) return '';
  const season = (p.seasons || []).map((s) => SEASON_LABELS[s] || s)[0] || '어느 계절이든';
  const situation = (p.situations || []).map((s) => SITUATION_LABELS[s] || s)[0] || '일상';
  const topNote = (p.notes && p.notes.top && p.notes.top[0]) || '첫 향';
  const baseNote = (p.notes && p.notes.base && p.notes.base[0]) || '잔향';
  const fam = koFams(p.families);

  return `${season}의 ${situation}. ${topNote}의 첫인상이 공기를 가볍게 열고, ${fam}의 결이 하루를 감싸다가 ${baseNote}의 잔향으로 남는 순간 — ${p.name}이(가) 어울립니다.`;
}

// ---------- 내부 헬퍼 ----------
function topNoteLine(p) {
  const t = (p.notes && p.notes.top && p.notes.top.slice(0, 2).join('·')) || '';
  return t ? `${t}로 문을 여는 첫인상이 특히 매력적이거든요.` : '';
}

function strongestDimension(breakdown) {
  if (!breakdown) return 'family';
  return Object.entries(breakdown).sort((x, y) => y[1] - x[1])[0][0];
}

function dimensionPhrase(dim) {
  switch (dim) {
    case 'family': return '무엇보다 선호하신 향 계열이 정확히 겹쳤고,';
    case 'season': return '고른 계절의 공기와 더없이 잘 맞았고,';
    case 'situation': return '원하신 상황에 자연스럽게 스며들었고,';
    case 'budget': return '예산 안에서 가장 합리적인 선택이었고,';
    case 'gender': return '타겟이 정확히 들어맞았고,';
    default: return '';
  }
}

// similarTo 는 원격 프록시가 관련 향을 확장 추천할 때 재사용하도록 재노출한다.
export { similarTo };
