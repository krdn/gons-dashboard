import type { InferSelectModel } from "drizzle-orm";
import type { stockTimeframeAnalyses } from "@/shared/lib/db/schema";
// tickerlens public 타입 re-export — 분석 모델의 단일 소스
export type {
  AnalysisResult,
  PerspectiveResult,
  PersonaSlots,
  PerspectiveSlot,
  TickerSnapshot,
  Persona,
  Timeframe,
  Signal,
  Evidence,
} from "@krdn/tickerlens";

export type StockTimeframeAnalysisRow = InferSelectModel<typeof stockTimeframeAnalyses>;

// 이력 목록 표시용 경량 타입 (result jsonb 제외)
export interface TimeframeHistoryItem {
  id: string;
  ticker: string;
  depth: string;
  asOf: Date;
  createdAt: Date;
}

export const PERSONAS = ["value", "growth", "quant", "options"] as const;
export const TIMEFRAMES = ["long", "mid", "short"] as const;
export const PERSONA_LABEL: Record<string, string> = {
  value: "가치",
  growth: "성장",
  quant: "퀀트",
  options: "옵션",
};
export const TIMEFRAME_LABEL: Record<string, string> = {
  long: "장기",
  mid: "중기",
  short: "단기",
};
