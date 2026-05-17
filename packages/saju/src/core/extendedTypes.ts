import type { ShenshaEntry } from "./shensha";
import type { Interactions } from "./interactions";
import type { Stem, Branch, TenGod, Element } from "../types";

export type School = "ko" | "cn-ziping" | "cn-mangpai" | "jp";
export type SchoolWithCompose = School | "compose";

/**
 * 진태양시(真太陽時) 메타데이터.
 *
 * - `trueSolarMinutesOffset`: 시계시 대비 진태양시 보정 분 (음수=시계시가 빠름).
 * - `hourKnown`: 출생 시각이 알려져 있는지 — false 면 시주 미상, 추명학 등은 정확도 ⚠.
 *
 * Phase 4 어댑터 공통 `ctx.trueSolar` 입력 + `TriNationLifetime.trueSolar` 출력에서
 * 공유 사용.
 */
export interface TrueSolarMeta {
  trueSolarMinutesOffset: number;
  hourKnown: boolean;
}

export interface ExtendedChart {
  shensha: ShenshaEntry[];
  interactions: Interactions;
  trueSolarMinutesOffset: number;
  hourAmbiguity?: {
    boundaryHour: number;
    candidateBranches: [Branch, Branch];
  };
}

export interface PillarAnnotation {
  pillar: "year" | "month" | "day" | "hour";
  stem: Stem;
  branch: Branch;
  tenGod?: TenGod;
  stage12?: string;
  note?: string;
}

export interface DaeunHighlight {
  startAge: number;
  pillar: "year" | "month" | "day" | "hour";
  significance: "길" | "흉" | "평" | "변화";
  reason: string;
}

export interface LifetimeFrame {
  school: School;
  pillarsAnnotated: PillarAnnotation[];
  formatGyeokguk: { name: string; reasoning: string };
  // 일부 학파(jp 등)는 용신 개념 미사용 — 그 경우 absent
  yongshin?: { element: Element; reasoning: string };
  daeunHighlights: DaeunHighlight[];
  careerHints: string[];
  relationshipHints: string[];
  healthHints: string[];
  cautions: string[];
  schoolSpecific: Record<string, unknown>;
}

export interface ConsensusReport {
  consensus: boolean;
  schools: Partial<Record<School, string>>;
}

export interface Conflict {
  field: "yongshin" | "gyeokguk";
  schools: Partial<Record<School, string>>;
}

export interface TriNationLifetime {
  chart: ExtendedChart;
  daeun: {
    startAge: number;
    direction: "forward" | "backward";
    pillars: Array<{ stem: Stem; branch: Branch; startAge: number }>;
  };
  trueSolar: TrueSolarMeta;
  frames: {
    ko: LifetimeFrame;
    cnZiping: LifetimeFrame;
    cnMangpai: LifetimeFrame;
    jp: LifetimeFrame;
  };
  crossCheck: {
    pillarsAgree: boolean;
    gyeokgukConsensus: ConsensusReport;
    yongshinConflicts: Conflict[];
  };
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: SajuError };
export interface SajuError {
  code: "INVALID_INPUT" | "OUT_OF_RANGE" | "AMBIGUOUS_HOUR" | "MISSING_HOUR" | "LIBRARY_MISMATCH";
  message: string;
  details?: unknown;
}
