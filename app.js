// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// app.js — SPA 컨트롤러. 해시 라우팅 + 뷰 렌더링 + 이벤트 위임.

import {
  recommend, similarTo, findByNote,
  FAMILY_LABELS, SEASON_LABELS, SITUATION_LABELS, GENDER_LABELS, BADGE_LABELS, WEIGHTS,
} from './recommender.js';
import { wishlist, compare, survey, resetAll } from './storage.js';
import { notePyramid, levelBar, scoreRing } from './svg.js';
import { askAI, parseTasteQuery, TASKS } from './ai/ai.js';

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
let PERFUMES = [];

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const won = (n) => '₩' + Number(n).toLocaleString('ko-KR');
const byId = (id) => PERFUMES.find((p) => p.id === id);
const famKo = (f) => FAMILY_LABELS[f] || f;

function toast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove('show'), 1900);
}

// AI 텍스트를 요소에 스트리밍으로 채운다(mock/실서버 공통). 버튼은 진행 중 비활성화.
async function streamAI(el, task, payload, trigger) {
  if (!el) return;
  el.textContent = '';
  el.classList.add('ai-streaming');
  if (trigger) { trigger.disabled = true; trigger.dataset.loading = '1'; }
  try {
    await askAI(task, payload, { onToken: (t) => { el.textContent += t; } });
  } catch (err) {
    el.textContent = `AI 호출에 실패했어요: ${err && err.message ? err.message : err}`;
  } finally {
    el.classList.remove('ai-streaming');
    if (trigger) { trigger.disabled = false; delete trigger.dataset.loading; }
  }
}

// ---------- 오늘의 추천 향 (autonomous, on-load) ----------
// 홈 진입 시 현재 계절·시간대를 읽어 매칭 엔진(recommend)으로 후보를 뽑고,
// askAI(consult)로 한 줄 다이제스트를 생성한다. mock 모드에서 서버·키 없이 그대로 동작한다.
// 세션당 1회만 생성해 캐시(재렌더/필터 클릭마다 재호출 방지).
const dailyPick = { text: '', done: false, running: false };

function seasonByMonth(m) {
  if (m === 11 || m <= 1) return 'winter';
  if (m <= 4) return 'spring';
  if (m <= 7) return 'summer';
  return 'autumn';
}
function dayPart(h) {
  if (h < 11) return { situation: 'office', ko: '아침' };
  if (h < 17) return { situation: 'daily', ko: '낮' };
  if (h < 21) return { situation: 'date', ko: '저녁' };
  return { situation: 'party', ko: '밤' };
}
function dailyContext() {
  const now = new Date();
  const season = seasonByMonth(now.getMonth());
  const part = dayPart(now.getHours());
  // 한국어 라벨로 질의를 만들어 parseTasteQuery(내부)가 계절·상황을 정확히 인식하게 한다.
  const query = `${SEASON_LABELS[season]} ${part.ko} ${SITUATION_LABELS[part.situation]}에 어울리는 향`;
  return { season, part, query };
}

async function renderDailyPick() {
  const out = document.getElementById('daily-pick-out');
  if (!out) return;
  if (dailyPick.done) { out.textContent = dailyPick.text; return; } // 캐시 재사용
  if (dailyPick.running) return;
  dailyPick.running = true;
  out.classList.add('ai-streaming');
  try {
    const { query } = dailyContext();
    dailyPick.text = await askAI(TASKS.CONSULT, { query, perfumes: PERFUMES, limit: 3 }, {
      onToken: (t) => { const el = document.getElementById('daily-pick-out'); if (el) el.textContent += t; },
    });
    dailyPick.done = true;
  } catch (_e) {
    // 무인 원칙: 실패해도 홈은 정상. 조용히 섹션을 비운다.
    dailyPick.text = '';
  } finally {
    dailyPick.running = false;
    const el = document.getElementById('daily-pick-out');
    if (el) { el.classList.remove('ai-streaming'); if (dailyPick.done) el.textContent = dailyPick.text; }
  }
}

function updateBadges() {
  const w = document.getElementById('nav-wish-count');
  const c = document.getElementById('nav-cmp-count');
  if (w) w.textContent = wishlist.get().length;
  if (c) c.textContent = compare.get().length;
}

// ---------- 카드 ----------
function badgeChips(p) {
  return p.badges.map((b) => `<span class="badge badge-${b}">${esc(BADGE_LABELS[b] || b)}</span>`).join('');
}
function perfumeCard(p, extra = '') {
  const inWish = wishlist.has(p.id);
  const inCmp = compare.has(p.id);
  return `<article class="card" data-id="${p.id}">
    <button class="wish-btn ${inWish ? 'on' : ''}" data-act="wish" data-id="${p.id}" aria-label="찜">${inWish ? '♥' : '♡'}</button>
    <a class="card-link" href="#/detail/${p.id}">
      <div class="card-fams">${p.families.map((f) => `<span class="chip">${esc(famKo(f))}</span>`).join('')}</div>
      <h3 class="card-name">${esc(p.name)}</h3>
      <p class="card-brand">${esc(p.brand)} · ${esc(GENDER_LABELS[p.gender])}</p>
      <p class="card-notes">${esc(p.notes.top.concat(p.notes.middle).slice(0, 4).join(' · '))}</p>
      <div class="card-badges">${badgeChips(p)}</div>
      <div class="card-foot">
        <span class="price">${won(p.price)}</span>
        <span class="rating">★ ${p.rating} <small>(${p.reviewCount})</small></span>
      </div>
      ${extra}
    </a>
    <button class="cmp-btn ${inCmp ? 'on' : ''}" data-act="cmp" data-id="${p.id}">${inCmp ? '비교중' : '비교담기'}</button>
  </article>`;
}

// ---------- 탐색 ----------
const browseState = { q: '', family: '', season: '', situation: '', gender: '', maxPrice: 0, sort: 'rating' };

function browseView() {
  const families = Object.entries(FAMILY_LABELS);
  const opt = (v, label, cur) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${esc(label)}</option>`;
  const dc = dailyContext();
  app.innerHTML = `
  <section class="hero">
    <h1>당신의 향을 찾아보세요</h1>
    <p>계열·계절·상황으로 탐색하거나, <a href="#/survey">향 추천 설문</a>으로 맞춤 추천을 받아보세요.</p>
  </section>
  <section class="daily-pick" id="daily-pick" aria-label="오늘의 추천 향">
    <h2>🗓️ 오늘의 추천 향 <small>${esc(SEASON_LABELS[dc.season])} · ${esc(dc.part.ko)}</small></h2>
    <p class="ai-output daily-pick-out" id="daily-pick-out" aria-live="polite"></p>
  </section>
  <section class="filters" aria-label="필터">
    <input id="f-q" class="f-search" type="search" placeholder="향수·브랜드·노트 검색" value="${esc(browseState.q)}" />
    <div class="chip-row" id="f-family">
      <button class="fchip ${browseState.family === '' ? 'on' : ''}" data-fam="">전체</button>
      ${families.map(([k, v]) => `<button class="fchip ${browseState.family === k ? 'on' : ''}" data-fam="${k}">${esc(v)}</button>`).join('')}
    </div>
    <div class="filter-selects">
      <select id="f-season">${opt('', '계절 전체', browseState.season)}${Object.entries(SEASON_LABELS).map(([k, v]) => opt(k, v, browseState.season)).join('')}</select>
      <select id="f-situation">${opt('', '상황 전체', browseState.situation)}${Object.entries(SITUATION_LABELS).map(([k, v]) => opt(k, v, browseState.situation)).join('')}</select>
      <select id="f-gender">${opt('', '성별 전체', browseState.gender)}${Object.entries(GENDER_LABELS).map(([k, v]) => opt(k, v, browseState.gender)).join('')}</select>
      <select id="f-sort">
        ${opt('rating', '평점 높은순', browseState.sort)}${opt('price-asc', '가격 낮은순', browseState.sort)}
        ${opt('price-desc', '가격 높은순', browseState.sort)}${opt('longevity', '지속력순', browseState.sort)}
        ${opt('name', '이름순', browseState.sort)}
      </select>
    </div>
  </section>
  <p class="result-count" id="browse-count"></p>
  <section class="grid" id="browse-grid" aria-live="polite"></section>`;

  const q = document.getElementById('f-q');
  q.addEventListener('input', () => { browseState.q = q.value; renderBrowseGrid(); });
  document.getElementById('f-family').addEventListener('click', (e) => {
    const b = e.target.closest('.fchip'); if (!b) return;
    browseState.family = b.dataset.fam; browseView(); // re-render chips
  });
  ['season', 'situation', 'gender', 'sort'].forEach((k) => {
    document.getElementById('f-' + k).addEventListener('change', (e) => { browseState[k] = e.target.value; renderBrowseGrid(); });
  });
  renderBrowseGrid();
  renderDailyPick(); // 무인 다이제스트(세션 캐시)
}

function applyBrowse() {
  let list = PERFUMES.slice();
  const q = browseState.q.trim().toLowerCase();
  if (q) list = list.filter((p) =>
    (p.name + p.brand).toLowerCase().includes(q) ||
    [...p.notes.top, ...p.notes.middle, ...p.notes.base].some((n) => n.toLowerCase().includes(q)));
  if (browseState.family) list = list.filter((p) => p.families.includes(browseState.family));
  if (browseState.season) list = list.filter((p) => p.seasons.includes(browseState.season));
  if (browseState.situation) list = list.filter((p) => p.situations.includes(browseState.situation));
  if (browseState.gender) list = list.filter((p) => p.gender === browseState.gender);
  const s = browseState.sort;
  list.sort((a, b) => {
    if (s === 'price-asc') return a.price - b.price;
    if (s === 'price-desc') return b.price - a.price;
    if (s === 'longevity') return b.longevity - a.longevity;
    if (s === 'name') return a.name.localeCompare(b.name, 'ko');
    return b.rating - a.rating;
  });
  return list;
}
function renderBrowseGrid() {
  const list = applyBrowse();
  document.getElementById('browse-count').textContent = `${list.length}개의 향수`;
  const grid = document.getElementById('browse-grid');
  grid.innerHTML = list.length ? list.map((p) => perfumeCard(p)).join('') : `<p class="empty">조건에 맞는 향수가 없어요.</p>`;
}

// ---------- 상세 ----------
function detailView(id) {
  const p = byId(id);
  if (!p) { app.innerHTML = `<p class="empty">향수를 찾을 수 없어요. <a href="#/">목록으로</a></p>`; return; }
  const inWish = wishlist.has(p.id), inCmp = compare.has(p.id);
  const cheapest = Math.min(...p.prices.map((x) => x.price));
  const priceRows = p.prices.map((x) => `<tr class="${x.price === cheapest ? 'best' : ''}">
      <td>${esc(x.seller)}</td><td class="num">${won(x.price)}</td>
      <td>${x.price === cheapest ? '<span class="best-tag">최저가</span>' : ''}</td></tr>`).join('');
  const reviews = p.reviews.map((r) => `<li><span class="rv-user">${esc(r.user)}</span> <span class="rv-star">★ ${r.rating}</span><p>${esc(r.text)}</p></li>`).join('');
  const sims = similarTo(p, PERFUMES, 4);

  app.innerHTML = `
  <a class="back" href="#/">← 목록</a>
  <section class="detail">
    <div class="detail-head">
      <div>
        <div class="card-fams">${p.families.map((f) => `<span class="chip">${esc(famKo(f))}</span>`).join('')}</div>
        <h1>${esc(p.name)}</h1>
        <p class="card-brand">${esc(p.brand)} · ${esc(GENDER_LABELS[p.gender])} · ${p.volumeMl}ml</p>
        <div class="card-badges">${badgeChips(p)}</div>
        <p class="rating big">★ ${p.rating} <small>(${p.reviewCount} 리뷰)</small></p>
        <div class="detail-actions">
          <button class="btn ${inWish ? 'on' : ''}" data-act="wish" data-id="${p.id}">${inWish ? '♥ 찜됨' : '♡ 찜하기'}</button>
          <button class="btn ${inCmp ? 'on' : ''}" data-act="cmp" data-id="${p.id}">${inCmp ? '비교중' : '＋ 비교담기'}</button>
        </div>
        <p class="desc">${esc(p.description)}</p>
        <div class="ai-moment">
          <button class="btn" id="ai-moment-btn">🤖 이 향이 어울리는 순간</button>
          <p class="ai-output ai-moment-out" id="ai-moment-out" aria-live="polite"></p>
        </div>
        <div class="tags">
          ${p.seasons.map((s) => `<span class="tag">${esc(SEASON_LABELS[s])}</span>`).join('')}
          ${p.situations.map((s) => `<span class="tag">${esc(SITUATION_LABELS[s])}</span>`).join('')}
        </div>
      </div>
      <div class="pyramid-wrap">
        <h2>노트 피라미드</h2>
        ${notePyramid(p.notes)}
      </div>
    </div>

    <div class="meters">
      <div><span class="meter-label">지속력</span>${levelBar('지속력', p.longevity)}</div>
      <div><span class="meter-label">확산력</span>${levelBar('확산력', p.sillage)}</div>
    </div>

    <h2>가격 비교 <small>(mock)</small></h2>
    <div class="table-wrap"><table class="price-table">
      <thead><tr><th>판매처</th><th class="num">가격</th><th></th></tr></thead>
      <tbody>${priceRows}</tbody></table></div>

    <h2>리뷰</h2>
    <ul class="reviews">${reviews}</ul>

    <h2>비슷한 향수</h2>
    <div class="grid grid-sim">${sims.map((s) => perfumeCard(s, `<span class="sim-tag">유사도 ${(s.sim * 100).toFixed(0)}%</span>`)).join('')}</div>
  </section>`;

  const momentBtn = document.getElementById('ai-moment-btn');
  if (momentBtn) momentBtn.addEventListener('click', () => {
    streamAI(document.getElementById('ai-moment-out'), TASKS.MOMENT, { perfume: p }, momentBtn);
  });
}

// ---------- 설문 ----------
function surveyView() {
  const prev = survey.get() || {};
  const chip = (name, k, v, cur) => `<label class="opt"><input type="${name === 'families' ? 'checkbox' : 'radio'}" name="${name}" value="${v}" ${(name === 'families' ? (cur || []).includes(v) : cur === v) ? 'checked' : ''}/><span>${esc(k)}</span></label>`;
  app.innerHTML = `
  <section class="survey">
    <h1>향 추천 설문</h1>
    <p class="sub">4가지만 고르면 매칭 점수로 향수를 추천해드려요.</p>
    <form id="survey-form">
      <fieldset><legend>좋아하는 계열 <small>(복수 선택)</small></legend>
        <div class="opts">${Object.entries(FAMILY_LABELS).map(([k, v]) => chip('families', v, k, prev.families)).join('')}</div>
      </fieldset>
      <fieldset><legend>주로 언제 쓰나요?</legend>
        <div class="opts">${Object.entries(SITUATION_LABELS).map(([k, v]) => chip('situation', v, k, prev.situation)).join('')}</div>
      </fieldset>
      <fieldset><legend>어느 계절에?</legend>
        <div class="opts">${Object.entries(SEASON_LABELS).map(([k, v]) => chip('season', v, k, prev.season)).join('')}</div>
      </fieldset>
      <fieldset><legend>성별 타겟</legend>
        <div class="opts">${chip('gender', '상관없음', 'any', prev.gender || 'any')}${Object.entries(GENDER_LABELS).map(([k, v]) => chip('gender', v, k, prev.gender)).join('')}</div>
      </fieldset>
      <fieldset><legend>예산 (최대): <output id="budget-out">${won(prev.budget || 200000)}</output></legend>
        <input type="range" id="budget" min="40000" max="300000" step="10000" value="${prev.budget || 200000}"/>
      </fieldset>
      <div class="survey-actions">
        <button type="submit" class="btn primary">추천 받기</button>
        <button type="button" class="btn" id="survey-reset">초기화</button>
      </div>
    </form>
  </section>`;

  const b = document.getElementById('budget');
  b.addEventListener('input', () => { document.getElementById('budget-out').textContent = won(b.value); });
  document.getElementById('survey-reset').addEventListener('click', () => { survey.clear(); surveyView(); });
  document.getElementById('survey-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const answers = {
      families: fd.getAll('families'),
      situation: fd.get('situation') || '',
      season: fd.get('season') || '',
      gender: fd.get('gender') || 'any',
      budget: Number(b.value),
    };
    survey.set(answers);
    location.hash = '#/results';
  });
}

function resultsView() {
  const answers = survey.get();
  if (!answers) { location.hash = '#/survey'; return; }
  const ranked = recommend(PERFUMES, answers, { limit: 12 });
  const chosen = (answers.families || []).map(famKo).join('·') || '전체';
  app.innerHTML = `
  <section class="results">
    <a class="back" href="#/survey">← 설문 수정</a>
    <h1>맞춤 추천</h1>
    <p class="sub">선호: ${esc(chosen)} · ${esc(SITUATION_LABELS[answers.situation] || '상황 무관')} · ${esc(SEASON_LABELS[answers.season] || '계절 무관')} · 예산 ${won(answers.budget)}</p>
    <div class="ai-rationale">
      <button class="btn" id="ai-why">🤖 AI로 추천 이유 서술받기</button>
      <div class="ai-output" id="ai-why-out" aria-live="polite"></div>
    </div>
    <div class="grid">
      ${ranked.map((p) => perfumeCard(p, `
        <div class="match">${scoreRing(p.score)}<ul class="reasons">${(p.reasons.length ? p.reasons : ['기본 매칭']).map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>`)).join('')}
    </div>
  </section>`;

  const whyBtn = document.getElementById('ai-why');
  if (whyBtn) whyBtn.addEventListener('click', () => {
    const results = ranked.slice(0, 3).map((p) => ({
      name: p.name, brand: p.brand, families: p.families,
      score: p.score, reasons: p.reasons, breakdown: p.breakdown,
    }));
    streamAI(document.getElementById('ai-why-out'), TASKS.RATIONALE, { answers, results }, whyBtn);
  });
}

// ---------- AI 향 컨설턴트 챗봇 ----------
const AI_EXAMPLES = [
  '여름 데이트에 어울리는 상큼한 시트러스, 15만원 이하',
  '겨울 오피스에서 은은한 우디 머스크',
  '봄 데일리로 가벼운 플로럴, 남성용',
];

function aiConsultView() {
  app.innerHTML = `
  <section class="ai-consult">
    <h1>AI 향 컨설턴트 🤖</h1>
    <p class="sub">원하는 향·계절·상황·예산을 자연어로 들려주세요. AI가 카탈로그에서 골라 이유와 함께 추천해드려요.</p>
    <div class="ai-note">데모는 내장 <strong>Mock AI</strong>로 동작합니다(서버·API 키 불필요). 실제 Claude 연동은 <code>ai/config.js</code> + <code>server/</code> 참고.</div>
    <form id="ai-form" class="ai-form">
      <textarea id="ai-query" rows="3" placeholder="예: ${esc(AI_EXAMPLES[0])}"></textarea>
      <div class="ai-examples">${AI_EXAMPLES.map((e) => `<button type="button" class="ex-chip" data-ex="${esc(e)}">${esc(e)}</button>`).join('')}</div>
      <button type="submit" class="btn primary" id="ai-go">추천 받기</button>
    </form>
    <div class="ai-out-wrap" id="ai-out-wrap" hidden>
      <h2>컨설턴트의 제안</h2>
      <div class="ai-output" id="ai-output" aria-live="polite"></div>
      <div class="grid" id="ai-picks"></div>
    </div>
  </section>`;

  const form = document.getElementById('ai-form');
  const ta = document.getElementById('ai-query');
  document.querySelectorAll('#ai-form .ex-chip').forEach((c) => c.addEventListener('click', () => {
    ta.value = c.dataset.ex; ta.focus();
  }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = ta.value.trim();
    if (!query) { toast('원하는 향을 한 줄로 적어주세요.'); return; }
    document.getElementById('ai-out-wrap').hidden = false;
    // 추천 카드: mock/실서버와 동일한 파서로 뽑아 화면에 함께 보여준다(단일 진실원천).
    const picks = recommend(PERFUMES, parseTasteQuery(query), { limit: 3 });
    document.getElementById('ai-picks').innerHTML = picks.map((p) => perfumeCard(p, `
      <div class="match">${scoreRing(p.score)}<ul class="reasons">${(p.reasons.length ? p.reasons : ['기본 매칭']).map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>`)).join('');
    await streamAI(document.getElementById('ai-output'), TASKS.CONSULT,
      { query, perfumes: PERFUMES, limit: 3 }, document.getElementById('ai-go'));
  });
}

// ---------- 노트로 찾기 ----------
function notesView() {
  const all = [...new Set(PERFUMES.flatMap((p) => [...p.notes.top, ...p.notes.middle, ...p.notes.base]))].sort((a, b) => a.localeCompare(b, 'ko'));
  app.innerHTML = `
  <section class="notes-search">
    <h1>노트로 찾기</h1>
    <p class="sub">특정 향료가 들어간 향수를 찾아보세요.</p>
    <div class="chip-row" id="note-chips">${all.map((n) => `<button class="fchip" data-note="${esc(n)}">${esc(n)}</button>`).join('')}</div>
    <p class="result-count" id="note-count"></p>
    <section class="grid" id="note-grid"></section>
  </section>`;
  document.getElementById('note-chips').addEventListener('click', (e) => {
    const b = e.target.closest('.fchip'); if (!b) return;
    document.querySelectorAll('#note-chips .fchip').forEach((x) => x.classList.toggle('on', x === b));
    const list = findByNote(PERFUMES, b.dataset.note);
    document.getElementById('note-count').textContent = `"${b.dataset.note}" 포함 ${list.length}개`;
    document.getElementById('note-grid').innerHTML = list.map((p) => perfumeCard(p)).join('');
  });
}

// ---------- 찜 ----------
function wishlistView() {
  const list = wishlist.get().map(byId).filter(Boolean);
  app.innerHTML = `
  <section class="wishlist">
    <h1>찜한 향수 <small>(${list.length})</small></h1>
    ${list.length ? `<div class="grid">${list.map((p) => perfumeCard(p)).join('')}</div>`
      : `<p class="empty">아직 찜한 향수가 없어요. <a href="#/">탐색하러 가기</a></p>`}
  </section>`;
}

// ---------- 비교 ----------
function compareView() {
  const list = compare.get().map(byId).filter(Boolean);
  if (!list.length) { app.innerHTML = `<section class="compare"><h1>비교</h1><p class="empty">비교할 향수를 담아주세요(최대 4개).</p></section>`; return; }
  const cheapest = Math.min(...list.map((p) => p.price));
  const best = (vals, v, hi = true) => v === (hi ? Math.max(...vals) : Math.min(...vals));
  const prices = list.map((p) => p.price), longs = list.map((p) => p.longevity), sils = list.map((p) => p.sillage), rats = list.map((p) => p.rating);
  const row = (label, cells) => `<tr><th>${label}</th>${cells}</tr>`;
  app.innerHTML = `
  <section class="compare">
    <div class="cmp-head"><h1>비교표 <small>(${list.length}/4)</small></h1><button class="btn" id="cmp-clear">전체 비우기</button></div>
    <div class="table-wrap"><table class="cmp-table">
      <thead><tr><th>항목</th>${list.map((p) => `<th><a href="#/detail/${p.id}">${esc(p.name)}</a><button class="x" data-act="cmp" data-id="${p.id}">✕</button></th>`).join('')}</tr></thead>
      <tbody>
        ${row('브랜드', list.map((p) => `<td>${esc(p.brand)}</td>`).join(''))}
        ${row('계열', list.map((p) => `<td>${p.families.map(famKo).join('·')}</td>`).join(''))}
        ${row('가격', list.map((p) => `<td class="${best(prices, p.price, false) ? 'hl' : ''}">${won(p.price)}</td>`).join(''))}
        ${row('평점', list.map((p) => `<td class="${best(rats, p.rating) ? 'hl' : ''}">★ ${p.rating}</td>`).join(''))}
        ${row('지속력', list.map((p) => `<td class="${best(longs, p.longevity) ? 'hl' : ''}">${p.longevity}/10</td>`).join(''))}
        ${row('확산력', list.map((p) => `<td class="${best(sils, p.sillage) ? 'hl' : ''}">${p.sillage}/10</td>`).join(''))}
        ${row('탑', list.map((p) => `<td>${esc(p.notes.top.join(', '))}</td>`).join(''))}
        ${row('미들', list.map((p) => `<td>${esc(p.notes.middle.join(', '))}</td>`).join(''))}
        ${row('라스트', list.map((p) => `<td>${esc(p.notes.base.join(', '))}</td>`).join(''))}
        ${row('계절', list.map((p) => `<td>${p.seasons.map((s) => SEASON_LABELS[s]).join(', ')}</td>`).join(''))}
        ${row('상황', list.map((p) => `<td>${p.situations.map((s) => SITUATION_LABELS[s]).join(', ')}</td>`).join(''))}
      </tbody>
    </table></div>
  </section>`;
  document.getElementById('cmp-clear').addEventListener('click', () => { compare.clear(); updateBadges(); compareView(); });
}

// ---------- 전역 이벤트 위임 (찜/비교 버튼) ----------
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  e.preventDefault();
  const id = btn.dataset.id;
  if (btn.dataset.act === 'wish') {
    wishlist.toggle(id);
    toast(wishlist.has(id) ? '찜했어요 ♥' : '찜 해제');
    updateBadges();
    rerouteSoft();
  } else if (btn.dataset.act === 'cmp') {
    const res = compare.toggle(id);
    if (!res.ok && res.reason === 'full') { toast('비교는 최대 4개까지예요.'); return; }
    toast(compare.has(id) ? '비교에 담았어요' : '비교에서 뺐어요');
    updateBadges();
    rerouteSoft();
  }
});

// 상태 변경 후 현재 뷰만 가볍게 갱신
function rerouteSoft() {
  const h = location.hash;
  if (h.startsWith('#/detail/')) detailView(h.split('/')[2]);
  else if (h.startsWith('#/wishlist')) wishlistView();
  else if (h.startsWith('#/compare')) compareView();
  else if (h.startsWith('#/results')) resultsView();
  else if (h.startsWith('#/notes')) { /* keep */ }
  else renderBrowseGrid();
}

// ---------- 라우터 ----------
function route() {
  updateBadges();
  const h = location.hash || '#/';
  window.scrollTo(0, 0);
  document.querySelectorAll('nav a[data-route]').forEach((a) => a.classList.toggle('active', h.startsWith(a.getAttribute('href'))));
  if (h.startsWith('#/detail/')) return detailView(h.split('/')[2]);
  if (h.startsWith('#/ai')) return aiConsultView();
  if (h.startsWith('#/survey')) return surveyView();
  if (h.startsWith('#/results')) return resultsView();
  if (h.startsWith('#/notes')) return notesView();
  if (h.startsWith('#/wishlist')) return wishlistView();
  if (h.startsWith('#/compare')) return compareView();
  return browseView();
}

// ---------- 부팅 ----------
async function boot() {
  try {
    const res = await fetch('./data/perfumes.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    PERFUMES = await res.json();
  } catch (err) {
    app.innerHTML = `<p class="empty">데이터를 불러오지 못했어요. 로컬 서버(예: <code>python -m http.server</code>)로 열어주세요.<br><small>${esc(err.message)}</small></p>`;
    return;
  }
  window.addEventListener('hashchange', route);
  const rst = document.getElementById('reset-all');
  if (rst) rst.addEventListener('click', () => {
    if (confirm('저장된 설문·찜·비교를 모두 초기화할까요?')) { resetAll(); updateBadges(); toast('초기화 완료'); route(); }
  });
  const tgl = document.getElementById('theme-toggle');
  if (tgl) tgl.addEventListener('click', toggleTheme);
  applyStoredTheme();
  route();
}

// ---------- 테마 ----------
function applyStoredTheme() {
  try {
    const t = localStorage.getItem('perfume-recommender:theme');
    if (t) document.documentElement.setAttribute('data-theme', t);
  } catch (_e) { /* ignore */ }
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : (cur === 'light' ? 'dark' : (matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark'));
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('perfume-recommender:theme', next); } catch (_e) { /* ignore */ }
}

boot();
