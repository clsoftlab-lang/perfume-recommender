<!--
SPDX-License-Identifier: Apache-2.0
Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
-->
# 🌸 Perfume Recommender

A no-build, static **single-page web app** that recommends and compares perfumes by
notes (top/middle/base), price, season, situation, gender and budget — with an
explainable, rule-based **matching engine**.

**한국어 문서: [README.ko.md](./README.ko.md)**

**LIVE DEMO: https://clsoftlab-lang.github.io/perfume-recommender/**

---

## What it is

Explore a catalog of fictional perfumes, open a detail page with an inline-SVG
**note pyramid** and longevity/sillage meters, take a short **survey** to get ranked
recommendations *with reasons*, search by a specific fragrance material, and build a
side-by-side **comparison** of up to 4 — all running fully client-side.

## How the matching engine works

Every perfume is scored **0–100** against the survey answers as a weighted sum of five
dimensions (weights always sum to 100). A dimension you leave blank is treated as
*neutral* and awarded full marks, so skipping a question never distorts the ranking.

| Dimension  | Weight | Rule |
|------------|:-----:|------|
| Note family | **40** | `40 × (matched preferred families ÷ chosen families)` |
| Season      | **20** | full if the perfume fits the chosen season, else 0 |
| Situation   | **20** | full if the perfume fits the chosen situation, else 0 |
| Budget      | **15** | full within budget; over budget decays linearly: `15 × max(0, 1 − (price−budget)/budget)` |
| Gender      | **5**  | full if unisex or target matches, else 0 |

Ties are broken by user rating. Each result carries the human-readable **reasons** that
earned its points (e.g. "선호 계열 우디 일치", "예산 이내"). See
[`recommender.js`](./recommender.js) — the same pure module powers the app and the tests.

- **Note pyramid** (`svg.js` → `notePyramid`): three stacked SVG trapezoids (top narrow →
  base wide) labelled 탑/미들/라스트 with the materials for each layer. Pure inline SVG,
  no binaries, dark-mode aware.
- **Price comparison**: each perfume carries several mock sellers; the detail view sorts
  them and tags the cheapest as 최저가. The compare table highlights the best cell per row
  (lowest price, highest rating/longevity/sillage).
- **Similar perfumes** (`similarTo`): similarity = family Jaccard (0.5) + all-notes Jaccard
  (0.35) + season/situation Jaccard (0.15).

## Features

- 향수 탐색 — filter by family / season / situation / gender + price, free-text search, and sort
- 향수 상세 — note pyramid, longevity & sillage bars, mock price comparison, tags, reviews, similar perfumes
- 향 추천 설문 → ranked recommendations with a match-score ring and per-item reasons
- 노트로 찾기 — find every perfume containing a chosen material
- 찜 & 비교 — wishlist and a compare table for up to 4 (best-in-row highlighting)
- Extras: 계절/상황 태그, 입문/시그니처/가성비 badges, value scoring, light/dark theme, one-click reset

## Run locally

No build step, no dependencies. Serve the folder over HTTP (ES modules + `fetch` need a server):

```bash
python -m http.server 8986
# open http://localhost:8986
```

Run the checks (JSON parse, JS syntax, index containers, recommender unit tests):

```bash
node check.mjs
```

## DEMO-MODE boundaries

**This is a demonstration build. Specifically:**

- **All perfumes, brands and prices are FICTIONAL** — generic fragrance materials, invented houses, no real product data.
- **Recommendations are RULE-BASED matching**, not ML and not professional fragrance advice.
- **Prices are MOCK** sample values, not live retail feeds.
- **localStorage is NOT a real database** — survey/wishlist/compare live only in your browser and can be cleared anytime (Reset button).
- **No real accounts, no sign-in, no PII** are collected or transmitted.
- A real build would add a real catalog, live price feeds, accounts, and server-side persistence.

## Tech

Plain HTML + CSS + ES-module JavaScript. No framework, no bundler, relative paths only —
deployable straight to GitHub Pages. Inline SVG for all visuals. CI runs `node check.mjs`.

```
index.html          app.js            recommender.js   (matching math)
styles.css          storage.js        svg.js           (inline-SVG rendering)
data/perfumes.json  check.mjs         .github/workflows/ci.yml
```

## Deploy (GitHub Pages)

Push to `main`, then in **Settings → Pages** choose *Deploy from a branch* → `main` / root.
Because every path is relative, it works from the project subpath as-is.

## Contributors

Dr. Lee Il-guk (이일국), LWJ, LMJ, Claude.

## License

- Code: **Apache-2.0** (see [`LICENSE`](./LICENSE)).
- Documentation: **CC BY 4.0**.

*Not an official Anthropic product.*

## 🎓 Idea origin

The seed idea for this project came from the **entrepreneurship class taught by Dr. Lee Il-guk (이일국) at Yongin University (용인대학교)**. The students in that class produced startup ideas of remarkable, standout creativity — this project is one of those exceptional ideas, finally brought to life as a working service. Built with deep admiration and gratitude for those students' imagination. *(No student personal information is included; only the idea itself was used, implemented clean-room.)*
