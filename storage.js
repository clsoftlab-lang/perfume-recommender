// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// storage.js — localStorage 래퍼. 모든 접근을 try/catch로 감싸 프라이빗 모드/차단
// 환경에서도 앱이 동작하도록 한다. 실패 시 메모리 폴백을 사용한다.

const PREFIX = 'perfume-recommender:';
const mem = new Map(); // localStorage 접근 실패 시 폴백

function read(key, fallback) {
  const k = PREFIX + key;
  try {
    const raw = localStorage.getItem(k);
    if (raw == null) return mem.has(k) ? mem.get(k) : fallback;
    return JSON.parse(raw);
  } catch (_e) {
    return mem.has(k) ? mem.get(k) : fallback;
  }
}

function write(key, value) {
  const k = PREFIX + key;
  mem.set(k, value);
  try {
    localStorage.setItem(k, JSON.stringify(value));
    return true;
  } catch (_e) {
    return false; // 메모리 폴백만 유지
  }
}

// 찜(wishlist): 향수 id 배열
export const wishlist = {
  get: () => read('wishlist', []),
  has: (id) => wishlist.get().includes(id),
  toggle(id) {
    const cur = wishlist.get();
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    write('wishlist', next);
    return next;
  },
  clear: () => write('wishlist', []),
};

// 비교(compare): 최대 4개
export const compare = {
  max: 4,
  get: () => read('compare', []),
  has: (id) => compare.get().includes(id),
  toggle(id) {
    const cur = compare.get();
    if (cur.includes(id)) {
      const next = cur.filter((x) => x !== id);
      write('compare', next);
      return { ok: true, list: next };
    }
    if (cur.length >= compare.max) return { ok: false, list: cur, reason: 'full' };
    const next = [...cur, id];
    write('compare', next);
    return { ok: true, list: next };
  },
  clear: () => write('compare', []),
};

// 설문 응답 저장
export const survey = {
  get: () => read('survey', null),
  set: (answers) => write('survey', answers),
  clear: () => write('survey', null),
};

// 전체 초기화(리셋)
export function resetAll() {
  survey.clear();
  wishlist.clear();
  compare.clear();
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  } catch (_e) { /* ignore */ }
  mem.clear();
}
