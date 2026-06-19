// yearly API 응답의 stable error code → 한국어 문구.
//
// 매핑 정책·공통 코드·PREFIX·fallback 은 shared/lib/saju/errorMessage 가 소유.
// yearly 고유 EXACT 코드(INVALID_YEAR)만 여기서 주입한다 — slice divergence 는 로컬 유지.
// (옛 byte-identical 복제는 후보 1(#182) shared/lib/saju 선례로 공유 추출 — 후보 3.
//  Phase 3 "의도적 복제" 노트는 이 추출로 supersede. divergence 는 slice 키뿐이었다.)
import { toUserMessage as toUserMessageBase } from "@/shared/lib/saju/errorMessage";

const SLICE_MAP: Record<string, string> = {
  INVALID_YEAR: "잘못된 연도 요청입니다 (1900~2100 범위 외).",
};

export function toUserMessage(code: string | null | undefined): string {
  return toUserMessageBase(code, SLICE_MAP);
}
