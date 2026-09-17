// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// ai/config.js — AI 엔드포인트 설정 (단 하나의 스위치).
//
//   AI_ENDPOINT === ""  →  내장 MockProvider 사용 (데모 기본값, 서버·키 불필요)
//   AI_ENDPOINT === "https://…/api/ai"  →  운영자가 배포한 백엔드 프록시로 스트리밍 호출
//
// ⚠️ 보안 원칙: 이 파일에도, 프런트엔드 어디에도 API 키를 두지 않는다.
// 실 LLM 호출은 반드시 server/ 프록시(서버 측 ANTHROPIC_API_KEY)를 경유한다.
// 브라우저에 키를 노출하는 순간 누구나 훔쳐 쓸 수 있다.

export const AI_ENDPOINT = "";
