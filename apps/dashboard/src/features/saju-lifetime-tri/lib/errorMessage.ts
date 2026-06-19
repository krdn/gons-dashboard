// narrative + lifetime API 응답의 stable error code → 한국어 문구.
//
// 매핑 정책·공통 코드·PREFIX·fallback 은 shared/lib/saju/errorMessage 가 소유.
// lifetime 은 slice 고유 EXACT 코드가 없어 공통 매핑만 사용한다 (만세력 합의 실패 등
// LifetimeBuildError 의 기타 message 는 공통 fallback 으로 원본 노출).
// (옛 byte-identical 복제는 후보 1(#182) shared/lib/saju 선례로 공유 추출 — 후보 3.
//  Phase 3 "의도적 복제" 노트는 이 추출로 supersede.)
export { toUserMessage } from "@/shared/lib/saju/errorMessage";
