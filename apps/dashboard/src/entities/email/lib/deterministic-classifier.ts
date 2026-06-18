// 결정적 1차 분류기 — LLM 호출 전에 명백한 케이스를 걸러낸다.
//
// 정책:
//  1. 마지막 발송자가 본인 → null (답장 불필요, 내가 마지막 답)
//  2. 한국어/영어 데드라인 키워드 → high candidate
//  3. 한국어/영어 질문 키워드 → med candidate
//  4. 위 두 조건 모두 없음 → null (LLM에 넘기지 않음 — 비용 절감)
//
// 디자인 문서 §"AI 분석은 스레드 단위"의 결정적 절. LLM 호출 비용·환각 모두 감소.
//
// 반환:
//  - 결과가 있으면 LLM은 "정밀 검증" 단계만 수행 (선필터 통과한 것만)
//  - null이면 LLM을 부르지 않음
import "server-only";
import type {
  ThreadInput,
  ClassificationResult,
  Severity,
} from "../model/types";

/** 분류기 버전 — DB의 classifier_version 컬럼에 기록. eval CI v0.2가 이걸 읽음. */
export const DETERMINISTIC_VERSION = "v1.0-deterministic";

/**
 * 한국어 + 영어 데드라인 단서. 매칭되면 high 후보.
 * 정규식 word boundary 회피 — 한국어는 \b가 작동하지 않음.
 */
const HIGH_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bdeadline\b/i, reason: "마감 임박" },
  { pattern: /\b(asap|urgent|immediately)\b/i, reason: "긴급 요청" },
  { pattern: /\bby\s+(eod|tomorrow|today|monday|tuesday|wednesday|thursday|friday|noon)\b/i, reason: "마감 임박" },
  { pattern: /(긴급|급함|급해|빨리)/, reason: "긴급 요청" },
  { pattern: /(오늘 내|오늘까지|내일까지|이번주까지|마감|기한|EOD)/i, reason: "마감 임박" },
  { pattern: /(부탁드립니다|회신 부탁|회신 부탁드립니다|답변 부탁)/, reason: "회신 요청" },
];

/**
 * 한국어 + 영어 질문/요청 단서. 매칭되면 med 후보.
 */
const MED_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\?$/, reason: "질문 포함" }, // subject 또는 snippet 끝의 ?
  { pattern: /\?(\s|$)/, reason: "질문 포함" }, // 본문 중간의 ?
  { pattern: /(어떻게|언제|왜|어디|무엇|뭐|누가|얼마)/, reason: "질문 포함" },
  { pattern: /(가능하신가요|가능할까요|어떠세요|어떨까요|괜찮으신가요)/, reason: "질문 포함" },
  // '드립니다' 단독 제외 — "감사/안내/보고/말씀드립니다" 등 답장 무관 정중
  // 맺음말까지 med 후보로 끌어올려 Haiku 직행시키던 비용 누수. 회신 의도가
  // 분명한 결합형("회신/검토 부탁드립니다")은 HIGH_PATTERNS 가 이미 잡는다.
  { pattern: /(부탁|요청)/, reason: "요청 포함" },
  { pattern: /\b(could you|can you|would you|please confirm|let me know|please review)\b/i, reason: "요청 포함" },
];

/**
 * @returns null = 답장 불필요 (LLM 호출 안 함) — 정확도 ~80% 가정
 *          ClassificationResult = LLM에 넘길 후보 (선필터 통과)
 */
export function classifyDeterministic(
  input: ThreadInput,
): ClassificationResult | null {
  // 정책 1: 마지막 발송자가 본인 → 내가 마지막에 답한 상태.
  if (input.lastSenderIsOwner) return null;
  if (input.lastSenderEmail.toLowerCase() === input.ownerEmail.toLowerCase()) {
    return null;
  }

  const haystack = `${input.subject}\n${input.snippet}`;

  // 정책 2: high 패턴.
  for (const { pattern, reason } of HIGH_PATTERNS) {
    if (pattern.test(haystack)) {
      return { severity: "high", reason, classifiedBy: "deterministic" };
    }
  }

  // 정책 3: med 패턴.
  for (const { pattern, reason } of MED_PATTERNS) {
    if (pattern.test(haystack)) {
      return { severity: "med", reason, classifiedBy: "deterministic" };
    }
  }

  // 정책 4: 단서 없음 → null.
  return null;
}

/**
 * 테스트 가시성을 위한 export — 패턴 자체를 테스트할 때 사용.
 */
export const __INTERNAL = { HIGH_PATTERNS, MED_PATTERNS };
export type { Severity };
