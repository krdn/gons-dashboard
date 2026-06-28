import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { playmcpProfiles } from "@/shared/lib/db/schema";
import { CompatibilityPicker } from "./CompatibilityPicker";

export const dynamic = "force-dynamic";

export default async function CompatibilityPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin");
  const profiles = await db
    .select({ id: playmcpProfiles.id, nickname: playmcpProfiles.nickname, relation: playmcpProfiles.relation })
    .from(playmcpProfiles)
    .where(eq(playmcpProfiles.userId, session.user.id))
    .orderBy(playmcpProfiles.createdAt);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">🐯 인연 궁합</h1>
        <p className="mt-1 text-sm text-gray-600">두 분의 사주를 모두 살펴 호(虎)가 인연을 풀어드립니다.</p>
      </header>
      {profiles.length < 2 ? (
        <p className="rounded border bg-yellow-50 p-4 text-sm text-yellow-900">
          궁합 분석에는 최소 2개의 프로필이 필요합니다. <Link className="underline" href="/tiger/manage">프로필 관리</Link> 에서 추가해 주세요.
        </p>
      ) : (
        <CompatibilityPicker profiles={profiles} />
      )}
    </main>
  );
}
