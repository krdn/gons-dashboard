// v0.3.1 — lifetime/yearly/monthly 모두 사용하는 narrative 표시 컴포넌트 묶음.
// 학파별 detail (KoSchoolDetail 등) 은 SchoolSpecificCard 내부에서만 dispatch
// 되므로 barrel 에서 노출하지 않음.
export { KeyTermsStrip } from "./KeyTermsStrip";
export { NarrativeSection } from "./NarrativeSection";
export { CitationsFootnote } from "./CitationsFootnote";
export { SchoolSpecificCard } from "./school-specific/SchoolSpecificCard";
export { ModelBadge } from "./ModelBadge";
