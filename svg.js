// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// svg.js — 인라인 SVG 렌더러 (바이너리 이미지 없음).
//   notePyramid : 탑/미들/라스트 3단 사다리꼴 피라미드 + 노트 라벨
//   levelBar    : 지속력/확산력 등 1~10 게이지 바
//   scoreRing   : 추천 매칭 점수 도넛(0~100)

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * 노트 피라미드. 위(탑)가 좁고 아래(베이스)가 넓은 3단 구조.
 * @param {{top:string[],middle:string[],base:string[]}} notes
 */
export function notePyramid(notes) {
  const W = 320, H = 210;
  const rows = [
    { key: 'top', label: '탑', items: notes.top || [], y: 12, h: 52, x0: 118, x1: 202, cls: 'pyr-top' },
    { key: 'middle', label: '미들', items: notes.middle || [], y: 70, h: 56, x0: 78, x1: 242, cls: 'pyr-mid' },
    { key: 'base', label: '라스트', items: notes.base || [], y: 132, h: 62, x0: 30, x1: 290, cls: 'pyr-base' },
  ];
  const parts = rows.map((r) => {
    const yb = r.y + r.h;
    // 위 변(x0..x1) 은 다음 단 폭에 맞춰 좁게 → 사다리꼴
    const topInset = r.key === 'top' ? 0 : 18;
    const pts = `${r.x0 + topInset},${r.y} ${r.x1 - topInset},${r.y} ${r.x1},${yb} ${r.x0},${yb}`;
    const label = `<text class="pyr-label" x="${W / 2}" y="${r.y + 16}" text-anchor="middle">${esc(r.label)}</text>`;
    const items = `<text class="pyr-notes" x="${W / 2}" y="${r.y + 36}" text-anchor="middle">${esc(r.items.join(' · '))}</text>`;
    return `<polygon class="${r.cls}" points="${pts}" rx="6"></polygon>${label}${items}`;
  }).join('');
  return `<svg class="note-pyramid" viewBox="0 0 ${W} ${H}" role="img" aria-label="노트 피라미드: 탑 ${esc((notes.top||[]).join(', '))}; 미들 ${esc((notes.middle||[]).join(', '))}; 라스트 ${esc((notes.base||[]).join(', '))}">${parts}</svg>`;
}

/** 1~10 레벨 게이지 바. */
export function levelBar(label, value, max = 10) {
  const W = 220, H = 26, pad = 2;
  const ratio = Math.max(0, Math.min(1, value / max));
  const fillW = Math.round((W - pad * 2) * ratio);
  return `<svg class="level-bar" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)} ${value}/${max}">`
    + `<rect class="lb-track" x="${pad}" y="${pad}" width="${W - pad * 2}" height="${H - pad * 2}" rx="6"></rect>`
    + `<rect class="lb-fill" x="${pad}" y="${pad}" width="${fillW}" height="${H - pad * 2}" rx="6"></rect>`
    + `<text class="lb-text" x="${W - 8}" y="${H / 2 + 4}" text-anchor="end">${value}/${max}</text>`
    + `</svg>`;
}

/** 0~100 매칭 점수 도넛. */
export function scoreRing(score) {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const r = 34, c = 2 * Math.PI * r, off = c * (1 - s / 100);
  return `<svg class="score-ring" viewBox="0 0 90 90" role="img" aria-label="매칭 점수 ${s}점">`
    + `<circle class="sr-track" cx="45" cy="45" r="${r}"></circle>`
    + `<circle class="sr-arc" cx="45" cy="45" r="${r}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" transform="rotate(-90 45 45)"></circle>`
    + `<text class="sr-num" x="45" y="49" text-anchor="middle">${s}</text>`
    + `<text class="sr-lbl" x="45" y="63" text-anchor="middle">점</text>`
    + `</svg>`;
}
