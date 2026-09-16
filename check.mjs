// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// check.mjs — CI 검증기.
//  1) 모든 JS 파일 node --check (구문)
//  2) data/perfumes.json 파싱 + 스키마/개수 검증
//  3) index.html 필수 컨테이너 존재
//  4) recommender.js 단위 테스트 (채점/랭킹/유사도/노트검색)
//
// 실패 시 프로세스 종료코드 1.

import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  scorePerfume, recommend, similarity, similarTo, findByNote, WEIGHTS,
} from './recommender.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const ok = (name) => { passed++; console.log('  ✓', name); };
const bad = (name, detail) => { failed++; console.error('  ✗', name, '—', detail); };
function assert(cond, name, detail = '') { cond ? ok(name) : bad(name, detail || 'assertion failed'); }
function eq(a, b, name) { assert(a === b, name, `expected ${b}, got ${a}`); }

// ---------- 1) node --check on all JS ----------
console.log('\n[1] JS 구문 검사 (node --check)');
for (const f of readdirSync(ROOT).filter((f) => f.endsWith('.js') || f.endsWith('.mjs'))) {
  try {
    execFileSync(process.execPath, ['--check', join(ROOT, f)], { stdio: 'pipe' });
    ok(f);
  } catch (e) {
    bad(f, String(e.stderr || e.message).split('\n')[0]);
  }
}

// ---------- 2) perfumes.json ----------
console.log('\n[2] perfumes.json 검증');
let perfumes = [];
try {
  perfumes = JSON.parse(readFileSync(join(ROOT, 'data', 'perfumes.json'), 'utf8'));
  ok('JSON 파싱');
} catch (e) { bad('JSON 파싱', e.message); }

assert(Array.isArray(perfumes) && perfumes.length >= 40, '향수 40개 이상', `got ${perfumes.length}`);
const ids = new Set();
let schemaOk = true;
for (const p of perfumes) {
  const good = p.id && p.name && p.brand && p.gender && Array.isArray(p.families) && p.families.length
    && p.notes && Array.isArray(p.notes.top) && Array.isArray(p.notes.middle) && Array.isArray(p.notes.base)
    && Array.isArray(p.seasons) && Array.isArray(p.situations)
    && typeof p.price === 'number' && typeof p.longevity === 'number' && typeof p.sillage === 'number'
    && typeof p.rating === 'number' && Array.isArray(p.prices) && p.prices.length && Array.isArray(p.reviews);
  if (!good) { schemaOk = false; bad('스키마', `향수 ${p.id || '?'} 필드 누락`); break; }
  ids.add(p.id);
}
if (schemaOk) ok('모든 향수 필수 필드 존재');
eq(ids.size, perfumes.length, 'id 고유성');
assert(perfumes.some((p) => p.badges?.includes('beginner')), '입문 배지 존재');
assert(perfumes.some((p) => p.badges?.includes('value')), '가성비 배지 존재');

// ---------- 3) index.html ----------
console.log('\n[3] index.html 필수 컨테이너');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
for (const needle of ['id="app"', 'href="./styles.css"', 'src="./app.js"', 'data-route', '데모 모드', 'id="toast"']) {
  assert(html.includes(needle), `포함: ${needle}`);
}

// ---------- 4) recommender 단위 테스트 ----------
console.log('\n[4] recommender.js 단위 테스트');
const FIX = [
  { id: 'A', name: 'A', gender: 'unisex', families: ['citrus', 'fresh'], notes: { top: ['베르가못'], middle: ['워터릴리'], base: ['화이트머스크'] }, seasons: ['summer'], situations: ['daily'], price: 50000, longevity: 5, sillage: 4, rating: 4.5, prices: [{ seller: 's', price: 50000 }], reviews: [] },
  { id: 'B', name: 'B', gender: 'men', families: ['woody', 'oriental'], notes: { top: ['블랙페퍼'], middle: ['패츌리'], base: ['앰버'] }, seasons: ['winter'], situations: ['date'], price: 200000, longevity: 9, sillage: 8, rating: 4.0, prices: [{ seller: 's', price: 200000 }], reviews: [] },
  { id: 'C', name: 'C', gender: 'women', families: ['citrus'], notes: { top: ['레몬', '베르가못'], middle: ['프리지아'], base: ['화이트머스크'] }, seasons: ['summer', 'spring'], situations: ['daily', 'office'], price: 80000, longevity: 6, sillage: 5, rating: 4.8, prices: [{ seller: 's', price: 80000 }], reviews: [] },
];
const ANS = { families: ['citrus'], season: 'summer', situation: 'daily', budget: 100000, gender: 'any' };

// 4a) 만점 케이스
const sa = scorePerfume(FIX[0], ANS);
eq(sa.total, 100, 'A: 완전 일치 → 100점');
eq(sa.breakdown.family, WEIGHTS.family, 'A: 계열 만점(40)');
eq(sa.breakdown.season, WEIGHTS.season, 'A: 계절 만점(20)');
eq(sa.breakdown.budget, WEIGHTS.budget, 'A: 예산 만점(15)');
assert(sa.reasons.length >= 3, 'A: 추천 이유 3개 이상');

// 4b) 불일치 케이스 (계열/계절/상황/예산 모두 불충족, 성별만 any)
const sb = scorePerfume(FIX[1], ANS);
eq(sb.total, WEIGHTS.gender, 'B: 성별 점수만 남음(5점)');
eq(sb.breakdown.family, 0, 'B: 계열 0점');
eq(sb.breakdown.budget, 0, 'B: 예산 초과 100% → 0점');

// 4c) 부분 계열 매칭
const partial = scorePerfume(FIX[0], { families: ['citrus', 'woody'] });
eq(partial.breakdown.family, Math.round(WEIGHTS.family * 0.5), '부분 계열(1/2) → 20점');

// 4d) 미응답 차원은 중립(만점)
const neutral = scorePerfume(FIX[1], {});
eq(neutral.total, 100, '빈 설문 → 모든 차원 중립 100점');

// 4e) 예산 초과 선형 감점 (초과율 20% → 15*0.8=12)
const overBudget = scorePerfume({ ...FIX[0], price: 120000 }, { budget: 100000 });
eq(overBudget.breakdown.budget, Math.round(WEIGHTS.budget * 0.8), '예산 20% 초과 → 12점');

// 4f) 랭킹: 동점(A·C=100)은 평점 높은 C 우선, B는 최하
const ranked = recommend(FIX, ANS);
eq(ranked.length, 3, 'recommend: 전체 반환');
eq(ranked[0].id, 'C', '1위 = C (동점 시 평점 우선)');
eq(ranked[1].id, 'A', '2위 = A');
eq(ranked[2].id, 'B', '3위 = B (최하)');
assert(ranked[0].score >= ranked[1].score && ranked[1].score >= ranked[2].score, '점수 내림차순');

// 4g) 유사도: A는 B보다 C와 더 유사(계열·노트 공유)
assert(similarity(FIX[0], FIX[2]) > similarity(FIX[0], FIX[1]), 'A↔C 유사도 > A↔B');
eq(similarTo(FIX[0], FIX, 1)[0].id, 'C', 'A와 가장 유사한 향수 = C');

// 4h) 노트로 찾기
const byNote = findByNote(FIX, '베르가못');
eq(byNote.length, 2, '"베르가못" 포함 = 2개 (A, C)');
eq(findByNote(FIX, '앰버').map((p) => p.id).join(','), 'B', '"앰버" 포함 = B');

// 4i) 실제 데이터로 스모크 테스트
if (perfumes.length) {
  const real = recommend(perfumes, { families: ['woody'], season: 'winter', situation: 'office', budget: 150000 }, { limit: 12 });
  eq(real.length, 12, '실데이터: limit 12 적용');
  assert(real.every((p, i) => i === 0 || real[i - 1].score >= p.score), '실데이터: 점수 내림차순');
  assert(real[0].reasons.length > 0, '실데이터: 1위에 추천 이유 존재');
}

// ---------- 결과 ----------
console.log(`\n결과: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
