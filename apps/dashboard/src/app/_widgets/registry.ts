import "server-only";
import { type ReactNode } from "react";
import { EmailDigestCard, EmailDigestSkeleton } from "@/widgets/email-digest";
import { ImportantEmailsCard, ImportantEmailsSkeleton } from "@/widgets/important-emails";
import { ServerOverviewCard, ServerOverviewSkeleton } from "@/widgets/server-overview";
import { StockAnalysisCard, StockAnalysisSkeleton } from "@/widgets/stock-analysis";
import { AutopilotCard, AutopilotSkeleton } from "@/widgets/autopilot";
import { FortuneCard, FortuneSkeleton } from "@/widgets/fortune";
import { CalendarCard, CalendarSkeleton } from "@/widgets/calendar";
import { SupplementCheckerCard } from "@/widgets/supplement-checker";

export interface WidgetEntry {
  id: string;
  column: "main" | "aside";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Component: (props: any) => ReactNode | Promise<ReactNode>;
  Skeleton?: () => ReactNode;
}

// 배열 위치 = 렌더 순서. column = 좌(main 7fr) / 우(aside 4fr).
export const WIDGET_REGISTRY: WidgetEntry[] = [
  { id: "email-digest", column: "main", Component: EmailDigestCard, Skeleton: EmailDigestSkeleton },
  { id: "important-emails", column: "main", Component: ImportantEmailsCard, Skeleton: ImportantEmailsSkeleton },
  { id: "server-overview", column: "main", Component: ServerOverviewCard, Skeleton: ServerOverviewSkeleton },
  { id: "stock-analysis", column: "main", Component: StockAnalysisCard, Skeleton: StockAnalysisSkeleton },
  { id: "autopilot", column: "main", Component: AutopilotCard, Skeleton: AutopilotSkeleton },
  { id: "fortune", column: "aside", Component: FortuneCard, Skeleton: FortuneSkeleton },
  { id: "calendar", column: "aside", Component: CalendarCard, Skeleton: CalendarSkeleton },
  { id: "supplement-checker", column: "aside", Component: SupplementCheckerCard },
];
