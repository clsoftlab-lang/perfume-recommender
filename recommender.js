// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// recommender.js — 향 추천 매칭 엔진 (rule-based, explainable, deterministic).
//
// 설계 개요
// ---------
// 각 향수를 설문 응답에 대해 0~100점으로 채점한다. 총점은 5개 차원의 가중 합이며,
// 가중치 합은 항상 100이다. 응답하지 않은(생략/"any") 차원은 "중립"으로 처리하여
// 해당 차원의 만점을 부여한다(미응답이 순위를 왜곡하지 않도록).
//
//   familyScore   (40)  선호 계열과 향수 계열의 교집합 비율
//   seasonScore   (20)  선택한 계절이 향수의 어울리는 계절에 포함되는가
//   situationScore(20)  선택한 상황이 향수의 어울리는 상황에 포함되는가
//   budgetScore   (15)  예산 이내면 만점, 초과 시 초과율에 비례해 감점
//   genderScore   (5)   성별 타겟 일치(유니섹스는 항상 일치)
//
// 동점 시 평점(rating)을 보조 정렬 키로 사용한다.

export const WEIGHTS = Object.freeze({
  family: 40,
  season: 20,
  situation: 20,
  budget: 15,
  gender: 5,
});

export const FAMILY_LABELS = Object.freeze({
  citrus: '시트러스', floral: '플로럴', woody: '우디', musk: '머스크',
  oriental: '오리엔탈', fresh: '프레시', gourmand: '구르망', aromatic: '아로마틱',
});
export const SEASON_LABELS = Object.freeze({
  spring: '봄', summer: '여름', autumn: '가을', winter: '겨울',
});
export const SITUATION_LABELS = Object.freeze({
  daily: '데일리', date: '데이트', office: '오피스', party: '파티', travel: '여행',
});
export const GENDER_LABELS = Object.freeze({
  women: '여성', men: '남성', unisex: '유니섹스',
});
export const BADGE_LABELS = Object.freeze({
  beginner: '입문 추천', signature: '시그니처', value: '가성비',
});

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/**
 * 하나의 향수를 설문 응답에 대해 채점한다.
 * @param {object} perfume  perfumes.json 항목
 * @param {object} answers  { families?: string[], season?: string, situation?: string, budget?: number, gender?: string }
 * @returns {{ total:number, breakdown:object, reasons:string[] }}
 */
export function scorePerfume(perfume, answers = {}) {
  const breakdown = {};
  const reasons = [];

  // 1) 계열 (40)
  const pref = Array.isArray(answers.families) ? answers.families.filter(Boolean) : [];
  if (pref.length === 0) {
    breakdown.family = WEIGHTS.family; // 중립
  } else {
    const set = new Set(perfume.families);
    const matched = pref.filter((f) => set.has(f));
    const coverage = matched.length / pref.length;
    breakdown.family = Math.round(WEIGHTS.family * coverage);
    if (matched.length > 0) {
      reasons.push(`선호 계열 ${matched.map((f) => FAMILY_LABELS[f] || f).join('·')} 일치`);
    }
  }

  // 2) 계절 (20)
  if (!answers.season) {
    breakdown.season = WEIGHTS.season;
  } else if ((perfume.seasons || []).includes(answers.season)) {
    breakdown.season = WEIGHTS.season;
    reasons.push(`${SEASON_LABELS[answers.season] || answers.season}에 어울림`);
  } else {
    breakdown.season = 0;
  }

  // 3) 상황 (20)
  if (!answers.situation) {
    breakdown.situation = WEIGHTS.situation;
  } else if ((perfume.situations || []).includes(answers.situation)) {
    breakdown.situation = WEIGHTS.situation;
    reasons.push(`${SITUATION_LABELS[answers.situation] || answers.situation} 상황에 적합`);
  } else {
    breakdown.situation = 0;
  }

  // 4) 예산 (15) — 이내면 만점, 초과 시 초과율만큼 선형 감점
  if (!answers.budget || answers.budget <= 0) {
    breakdown.budget = WEIGHTS.budget;
  } else if (perfume.price <= answers.budget) {
    breakdown.budget = WEIGHTS.budget;
    reasons.push('예산 이내');
  } else {
    const over = (perfume.price - answers.budget) / answers.budget;
    breakdown.budget = Math.round(WEIGHTS.budget * clamp(1 - over, 0, 1));
  }

  // 5) 성별 (5) — 유니섹스이거나 타겟 일치 시 만점
  if (!answers.gender || answers.gender === 'any') {
    breakdown.gender = WEIGHTS.gender;
  } else if (perfume.gender === 'unisex' || perfume.gender === answers.gender) {
    breakdown.gender = WEIGHTS.gender;
  } else {
    breakdown.gender = 0;
  }

  const total = breakdown.family + breakdown.season + breakdown.situation + breakdown.budget + breakdown.gender;
  return { total, breakdown, reasons };
}

/**
 * 전체 향수 목록을 채점하여 점수 내림차순으로 정렬해 반환한다(동점은 평점 우선).
 * @returns {Array<perfume & { score:number, breakdown:object, reasons:string[] }>}
 */
export function recommend(perfumes, answers = {}, { limit = Infinity } = {}) {
  return perfumes
    .map((p) => {
      const s = scorePerfume(p, answers);
      return { ...p, score: s.total, breakdown: s.breakdown, reasons: s.reasons };
    })
    .sort((a, b) => (b.score - a.score) || ((b.rating || 0) - (a.rating || 0)) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/**
 * 두 향수의 유사도(0~1). 계열 Jaccard(0.5) + 전체 노트 Jaccard(0.35) + 계절/상황(0.15).
 */
export function similarity(a, b) {
  const jac = (x, y) => {
    const A = new Set(x), B = new Set(y);
    if (A.size === 0 && B.size === 0) return 0;
    let inter = 0;
    for (const v of A) if (B.has(v)) inter++;
    return inter / (A.size + B.size - inter);
  };
  const notesOf = (p) => [...p.notes.top, ...p.notes.middle, ...p.notes.base];
  const famJac = jac(a.families, b.families);
  const noteJac = jac(notesOf(a), notesOf(b));
  const ctxJac = (jac(a.seasons, b.seasons) + jac(a.situations, b.situations)) / 2;
  return +(0.5 * famJac + 0.35 * noteJac + 0.15 * ctxJac).toFixed(4);
}

/** 특정 향수와 가장 비슷한 향수 N개(자기 자신 제외). */
export function similarTo(perfume, perfumes, n = 4) {
  return perfumes
    .filter((p) => p.id !== perfume.id)
    .map((p) => ({ ...p, sim: similarity(perfume, p) }))
    .sort((a, b) => b.sim - a.sim || (b.rating || 0) - (a.rating || 0))
    .slice(0, n);
}

/** 특정 향료(노트)를 포함하는 향수 찾기. */
export function findByNote(perfumes, note) {
  const q = String(note).trim();
  if (!q) return [];
  return perfumes.filter((p) =>
    [...p.notes.top, ...p.notes.middle, ...p.notes.base].some((x) => x.includes(q)),
  );
}
