import type { PersonaKey } from "./persona-types";

export type RunStatus = "queued" | "running" | "completed" | "failed";

export interface AnalysisRun {
  id: string;
  userId: string;
  symbol: string;
  persona: PersonaKey | null;
  status: RunStatus;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}
