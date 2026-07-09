// 3층 시스템 프롬프트의 서버 전용 부분 — 하드 계약 + 충실 가드 + 프리셋별 스타일 지시.
// client-safe 메타(preset-meta.ts)와 분리해 프롬프트가 client 번들로 새지 않게 한다.
import "server-only";
import type { TransformPresetId } from "@/entities/memo/client";

// 3층: 프리셋별 스타일 지시 (조립은 buildTransformSystemPrompt 참조).
export const PRESET_INSTRUCTIONS: Record<TransformPresetId, string> = {
  tidy: `스타일: 정돈. 군말("음…", "어…", "그…")·반복·받아쓰기 오류만 제거하고 문장부호와 문단을 정리한다. 요약하지 않는다. 원문의 모든 정보를 보존한다. 내용을 삭제하지 않는다 (군말 제외).`,
  polish: `스타일: 매끄럽게. 받아쓰기 오류와 어색한 문장을 자연스러운 문어체로 재작성한다. 정보를 전부 보존하고 요약하지 않는다.`,
  summary: `스타일: 요약. 핵심만 3~5문장 또는 3~5개 불릿으로 압축한다. 사소한 세부는 생략해도 된다.`,
  structured: `스타일: 구조화. 내용을 주제별로 나눠 마크다운 헤딩(##)과 불릿(-)으로 재구성한다. 정보는 보존하되 문장은 간결하게 다듬어도 된다.`,
  todos: `스타일: 할 일 추출. 실행할 액션 아이템만 골라 "- [ ] 항목" 마크다운 체크리스트로 만든다. 할 일이 전혀 없으면 정확히 "할 일 없음" 한 줄만 출력한다.`,
  journal: `스타일: 일기체. 정돈된 일기(저널) 문체로 재구성한다. 사실 관계와 감정 표현을 보존하고 새로운 해석을 덧붙이지 않는다.`,
  email: `스타일: 이메일 초안. 인사말, 본문, 맺음말을 갖춘 정중한 이메일 초안으로 재구성한다. 수신자 이름이 원문에 없으면 "안녕하세요," 로 시작한다.`,
};

// 1층: 하드 계약 — 편집 불가. JSON 출력 계약이 여기 있어 Zod 파싱 실패를 격리한다.
// 페르소나 중립 문구 (커스텀 프리셋의 자유 역할 부여와 싸우지 않게).
export const HARD_CONTRACT = `개인 메모를 아래 지시에 따라 변환하는 작업입니다.

응답은 반드시 JSON: {"content": "변환된 전체 텍스트"}`;

// 2층: 원문 충실 가드 — 프리셋별 토글 (fidelity_guard=true일 때만 삽입).
export const FIDELITY_GUARD = `절대 규칙:
- 고유명사·숫자·날짜를 임의로 바꾸지 않는다.
- 원문에 없는 내용을 추가하지 않는다.
- 판단·평가·조언·안전 문구를 넣지 않는다.
- 한국어 메모는 한국어로 유지한다.`;

/** 3층 조립: 하드 계약 + (가드) + 스타일 지시. */
export function buildTransformSystemPrompt(
  instruction: string,
  fidelityGuard: boolean
): string {
  return [HARD_CONTRACT, fidelityGuard ? FIDELITY_GUARD : null, instruction]
    .filter(Boolean)
    .join("\n\n");
}
