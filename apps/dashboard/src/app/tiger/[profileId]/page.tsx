import { redirect, notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { playmcpProfiles } from "@/shared/lib/db/schema";
import { analyzeProfile } from "@/features/tiger-consult";
import { TigerAnalysisCard } from "@/widgets/tiger-cards";
import { TigerErrorPanel } from "@/entities/tiger-reading/ui/TigerErrorPanel";
import { isPlayMCPError } from "@/features/tiger-consult/lib/errors";
import { LazyCards } from "./LazyCards";

export const dynamic = "force-dynamic";

export default async function TigerProfilePage({ params }: { params: Promise<{ profileId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin");
  const { profileId } = await params;
  const rows = await db
    .select()
    .from(playmcpProfiles)
    .where(and(eq(playmcpProfiles.id, profileId), eq(playmcpProfiles.userId, session.user.id)))
    .limit(1);
  if (!rows[0]) notFound();
  const profile = rows[0];

  let analysisPayload: Awaited<ReturnType<typeof analyzeProfile>>["payload"] | null = null;
  let analysisError: string | null = null;
  try {
    const { payload } = await analyzeProfile(profileId);
    analysisPayload = payload;
  } catch (err) {
    analysisError = isPlayMCPError(err) ? err.message : "분석 호출 실패";
  }

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <header>
        <h1 className="text-2xl font-bold">🐯 {profile.nickname}</h1>
        <p className="text-sm text-gray-600">
          {profile.relation} · {profile.birthDate} · {profile.gender === "male" ? "남자" : "여자"}
        </p>
      </header>
      {analysisPayload ? (
        <TigerAnalysisCard payload={analysisPayload} />
      ) : (
        <TigerErrorPanel body={analysisError ?? "분석 호출 실패"} />
      )}
      <LazyCards profileId={profileId} nickname={profile.nickname} />
    </main>
  );
}
