import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import {
  listMemoFactsForInsights,
  listDigestsByUser,
  listActionItemsByUser,
  listTransformationsByUser,
  listCategories,
} from "@/entities/memo/server";
import {
  buildActivityHeatmap,
  buildDailyTrend,
  buildCategoryDistribution,
  buildActionConversion,
  buildDigestTimeline,
} from "@/widgets/memo-insights/server";
import { MemoInsightsView } from "@/widgets/memo-insights";
import { PageContainer } from "@/shared/ui/PageContainer";
import { PageHeader } from "@/shared/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function MemoInsightsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  // now를 한 번 캡처해 시간 의존 집계에 주입 (KST 산술 고정, 순수성 유지).
  const now = new Date();

  const [facts, digests, actionItems, transformations, categories] = await Promise.all([
    listMemoFactsForInsights(userId),
    listDigestsByUser(userId),
    // 상태 분포용 — 4개 상태 전부.
    listActionItemsByUser(userId, ["proposed", "accepted", "done", "dismissed"]),
    listTransformationsByUser(userId),
    listCategories(),
  ]);

  const heatmap = buildActivityHeatmap(facts, now);
  const trend = buildDailyTrend(facts, now, 30);
  const category = buildCategoryDistribution(facts, categories);
  const conversion = buildActionConversion(facts, actionItems, transformations);
  const digestTimeline = buildDigestTimeline(digests);

  return (
    <PageContainer width="narrow">
      <PageHeader
        title="메모 인사이트"
        subtitle="쌓인 메모를 분석해 기록 습관·주제·전환·회고를 한눈에 봐요."
        actions={
          <Link href="/memos" className="text-sm text-neutral-500 hover:text-neutral-900">
            ← 메모
          </Link>
        }
      />
      <MemoInsightsView
        heatmap={heatmap}
        trend={trend}
        category={category}
        conversion={conversion}
        digestTimeline={digestTimeline}
      />
    </PageContainer>
  );
}
