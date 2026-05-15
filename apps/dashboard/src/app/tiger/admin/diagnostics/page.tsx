import { redirect } from "next/navigation";
import { count } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { env } from "@/shared/config/env";
import {
  playmcpAnalysis, playmcpYearly, playmcpDaily, playmcpCompatibility,
} from "@/shared/lib/db/schema";
import { getCredentialsSummary } from "@/features/tiger-consult/lib/playmcp-credentials";
import { isAdmin } from "@/features/container-actions";

export const dynamic = "force-dynamic";

export default async function TigerDiagnosticsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin");
  if (!isAdmin(session.user.email ?? null, env.ADMIN_EMAILS)) {
    return <main className="mx-auto max-w-3xl p-8"><p>관리자 권한 필요.</p></main>;
  }
  const [
    cred,
    [{ n: nAnalysis }],
    [{ n: nYearly }],
    [{ n: nDaily }],
    [{ n: nCompat }],
  ] = await Promise.all([
    getCredentialsSummary(),
    db.select({ n: count() }).from(playmcpAnalysis),
    db.select({ n: count() }).from(playmcpYearly),
    db.select({ n: count() }).from(playmcpDaily),
    db.select({ n: count() }).from(playmcpCompatibility),
  ]);

  const now = new Date().getTime();
  const accessRemainMin = cred.accessExpiresAt
    ? Math.round((cred.accessExpiresAt.getTime() - now) / 60_000)
    : null;
  const refreshRemainDays = cred.refreshExpiresAt
    ? Math.round((cred.refreshExpiresAt.getTime() - now) / 86400_000)
    : null;

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-bold">🐯 호(虎) 진단</h1>

      <section className="rounded-xl border bg-white p-4">
        <h2 className="mb-3 font-semibold">PlayMCP 자격증명</h2>
        {cred.configured ? (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-gray-600">access_token 남은 시간</dt>
            <dd className={accessRemainMin !== null && accessRemainMin < 30 ? "font-bold text-red-600" : ""}>
              {accessRemainMin} 분
            </dd>
            <dt className="text-gray-600">refresh_token 남은 시간</dt>
            <dd className={refreshRemainDays !== null && refreshRemainDays < 7 ? "font-bold text-red-600" : ""}>
              {refreshRemainDays} 일
            </dd>
            <dt className="text-gray-600">마지막 갱신</dt>
            <dd>{cred.updatedAt?.toISOString().slice(0, 19)}</dd>
          </dl>
        ) : (
          <p className="text-sm text-red-700">
            credentials 미설정. <code>pnpm tiger:bootstrap --ott &lt;OTT&gt;</code> 실행 필요.
          </p>
        )}
      </section>

      <section className="rounded-xl border bg-white p-4">
        <h2 className="mb-3 font-semibold">캐시 row 수</h2>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt>analysis</dt><dd>{nAnalysis}</dd>
          <dt>yearly</dt><dd>{nYearly}</dd>
          <dt>daily</dt><dd>{nDaily}</dd>
          <dt>compatibility</dt><dd>{nCompat}</dd>
        </dl>
      </section>

      <section className="rounded-xl border bg-amber-50 p-4 text-sm text-amber-900">
        ℹ️ cross-talk 감지 통계는 stderr 로그 (Docker logs) 에서 확인:
        <code className="ml-2 rounded bg-amber-100 px-1">grep playmcp_cross_talk_detected</code>
      </section>
    </main>
  );
}
