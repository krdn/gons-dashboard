import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { playmcpProfiles } from "@/shared/lib/db/schema";
import { PageContainer } from "@/shared/ui/PageContainer";
import { PageHeader } from "@/shared/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function TigerHomePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const profiles = await db
    .select()
    .from(playmcpProfiles)
    .where(eq(playmcpProfiles.userId, session.user.id))
    .orderBy(playmcpProfiles.createdAt);

  return (
    <PageContainer width="narrow">
      <PageHeader
        title="🐯 호(虎) 상담"
        subtitle="1FATE 호작엔진이 분석하고, 호(虎)가 풀어드리는 사주 상담입니다."
      />

      {profiles.length === 0 ? (
        <section className="rounded-xl border bg-white p-8 text-center">
          <p className="text-gray-700">아직 등록된 프로필이 없습니다.</p>
          <Link
            href="/tiger/manage"
            className="mt-4 inline-block rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
          >
            프로필 등록하기
          </Link>
        </section>
      ) : (
        <ul className="space-y-3">
          {profiles.map((p) => (
            <li key={p.id}>
              <Link
                href={`/tiger/${p.id}`}
                className="block rounded-lg border bg-white p-4 transition hover:border-amber-300 hover:bg-amber-50"
              >
                <p className="font-medium">{p.nickname}</p>
                <p className="text-sm text-gray-600">
                  {p.relation} · {p.birthDate} · {p.gender === "male" ? "남자" : "여자"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <nav className="mt-6 flex gap-3 text-sm">
        <Link href="/tiger/manage" className="text-amber-700 underline">프로필 관리</Link>
        <Link href="/tiger/compatibility" className="text-amber-700 underline">인연 궁합</Link>
      </nav>
    </PageContainer>
  );
}
