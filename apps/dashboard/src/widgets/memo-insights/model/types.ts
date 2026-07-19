// 인사이트 집계 결과 타입 — 중립 모듈(server.ts·client 뷰 공유, DOM/DB 의존 없음).
// lib/aggregate.ts가 생산하고 ui/*가 소비한다.
import type { ActionItemStatus } from "@/entities/memo/client";

/** 히트맵 한 칸 — locale-free 날짜 + 그 날 메모 수. count:0 셀도 존재. */
export interface DayCell {
  date: string; // 'YYYY-MM-DD' (KST)
  count: number;
}

export interface ActivityHeatmap {
  weeks: DayCell[][]; // 26주 × 7일 고정 그리드
  windowCount: number; // 182일 창 내부 메모 수 (분자)
  totalCount: number; // 전체 이력 수 (요약 표시용)
  currentStreak: number;
  longestStreak: number;
  dailyAvg: number; // windowCount / 182
}

export interface DailyTrendPoint {
  date: string; // 'YYYY-MM-DD'
  count: number;
}

export interface CategoryDistribution {
  byCategory: { slug: string; labelKo: string; count: number }[];
  voiceCount: number;
  textCount: number;
  agentCount: number;
  unclassifiedCount: number;
}

export interface ActionConversion {
  // 메모 단위 퍼널 (단조 감소 보장)
  totalMemos: number;
  processedMemos: number; // actionsExtractedAt != null 메모 수
  memosWithActions: number; // 액션 행 1개 이상인 고유 memoId 수
  // 액션-행 단위 현재 상태 분포 (퍼널 밖, 별도 표시)
  currentStatusCounts: Record<ActionItemStatus, number>;
  // 변환본
  transformCount: number;
  transformByPreset: { slug: string; label: string; count: number }[];
}

export interface DigestTimelinePoint {
  weekEnd: string; // 'YYYY-MM-DD'
  memoCount: number;
  resurfacedCount: number;
}
