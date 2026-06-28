import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { playmcpProfiles } from "@/shared/lib/db/schema";
import { TigerProfileForm } from "./TigerProfileForm";

export const dynamic = "force-dynamic";

export default async function TigerManagePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const profiles = await db
    .select()
    .from(playmcpProfiles)
    .where(eq(playmcpProfiles.userId, session.user.id))
    .orderBy(playmcpProfiles.createdAt);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">🐯 프로필 관리</h1>
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">새 프로필 등록</h2>
        <TigerProfileForm mode="create" />
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold">등록된 프로필</h2>
        {profiles.length === 0 ? (
          <p className="text-sm text-gray-600">등록된 프로필이 없습니다.</p>
        ) : (
          <ul className="space-y-3">
            {profiles.map((p) => (
              <li key={p.id} className="rounded border bg-white p-4">
                <details>
                  <summary className="cursor-pointer">
                    <span className="font-medium">{p.nickname}</span>{" "}
                    <span className="text-sm text-gray-600">({p.relation} · {p.birthDate})</span>
                  </summary>
                  <div className="mt-3">
                    <TigerProfileForm mode="edit" profile={p} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
