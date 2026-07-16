// 메모 도움말 정적 콘텐츠 타입 — client 안전 (DB·server 의존 없음).
// 콘텐츠 진실의 원천은 help-content.ts 하나 — 기능이 바뀌면 그 파일만 고친다.

/** 여정 지도 4구간 + 지도 밖 관리 섹션. */
export type HelpChapterId = "capture" | "auto" | "use" | "review" | "manage";

export interface HelpChapter {
  id: HelpChapterId;
  title: string;
  /** 구간이 답하는 한 줄 — 지도 레인 헤더와 상세 섹션 헤더가 공유. */
  tagline: string;
  /** true면 생애주기 지도에 레인으로 렌더, false면 하단 상세에만. */
  inFlow: boolean;
}

export interface HelpFeature {
  id: string;
  chapterId: HelpChapterId;
  /** 지도 노드·상세 카드 공용 아이콘 (이모지). */
  icon: string;
  title: string;
  /** true면 사용자가 아무것도 안 해도 시스템이 수행 — 지도·카드에 "자동" 뱃지. */
  auto?: boolean;
  /** 한 줄 요약 — 지도 노드 title 속성과 상세 카드 리드 문장. */
  summary: string;
  /** 사용 방법 (auto 기능이면 동작 방식) — 순서 있는 단계. */
  steps: string[];
  tips?: string[];
  /** 기능이 사는 화면으로 바로가기. */
  link?: { href: string; label: string };
}

export interface MemoHelpGuide {
  /** 처음 온 사용자용 30초 시작 3단계. */
  quickStart: string[];
  chapters: HelpChapter[];
  features: HelpFeature[];
}
