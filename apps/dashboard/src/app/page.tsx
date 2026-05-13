// 메인 대시보드.
// 와이어프레임 reference:
//   ~/.gstack/projects/krdn-gons-dashboard/designs/main-dashboard-20260509/wireframe-v1.html
//
// 좌(7) + 우(4) 비대칭 그리드. 좌에 EmailDigestCard, 우에 향후 위젯 placeholder.
// 비로그인 상태면 /login으로 리다이렉트.

import { redirect } from "next/navigation";
import { Suspense } from "react";
import { auth, signOut } from "@/shared/lib/auth";
import {
  EmailDigestCard,
  EmailDigestSkeleton,
  PushSubscribeButton,
} from "@/widgets/email-digest";
import {
  ImportantEmailsCard,
  ImportantEmailsSkeleton,
} from "@/widgets/important-emails";
import {
  ServerOverviewCard,
  ServerOverviewSkeleton,
} from "@/widgets/server-overview";
import { CalendarCard, CalendarSkeleton } from "@/widgets/calendar";
import { FortuneCard, FortuneSkeleton } from "@/widgets/fortune";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const greetingName = session.user.name ?? session.user.email ?? "";

  // KST 시각 — Server에서 Asia/Seoul로 강제 (TZ env).
  const nowKst = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());

  return (
    <main className="mx-auto w-full max-w-[1240px] px-6 py-12">
      <header className="mb-12">
        <h1 className="text-display font-bold tracking-tight">
          gons<span className="text-[var(--color-accent)]">.</span>dashboard
        </h1>
        <div className="mt-2 flex items-baseline gap-2 text-xs text-[var(--color-text-muted)] tabular-nums">
          <span>{nowKst} KST</span>
          {greetingName && (
            <>
              <span aria-hidden>·</span>
              <span>{greetingName}</span>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/login" });
                }}
              >
                <button
                  type="submit"
                  className="rounded border border-[var(--color-hairline)] px-2 py-0.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
                  aria-label="로그아웃"
                >
                  로그아웃
                </button>
              </form>
            </>
          )}
        </div>
      </header>

      <section className="mb-12">
        <h2 className="text-[28px] font-bold tracking-tight md:text-display">
          좋은 아침입니다{" "}
          <em className="not-italic font-semibold text-[var(--color-text-muted)]">
            — 오늘도 조금 챙길 일이 있어요
          </em>
        </h2>
      </section>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">
        <div className="flex flex-col gap-10">
          <Suspense fallback={<EmailDigestSkeleton />}>
            <EmailDigestCard />
          </Suspense>
          <Suspense fallback={<ImportantEmailsSkeleton />}>
            <ImportantEmailsCard />
          </Suspense>
          <Suspense fallback={<ServerOverviewSkeleton />}>
            <ServerOverviewCard />
          </Suspense>
        </div>

        <aside aria-label="우측 위젯" className="flex flex-col gap-4">
          <Suspense fallback={<FortuneSkeleton />}>
            <FortuneCard />
          </Suspense>
          <Suspense fallback={<CalendarSkeleton />}>
            <CalendarCard />
          </Suspense>
          <div className="rounded-xl border border-dashed border-[var(--color-hairline-strong)] bg-[var(--color-surface)] px-5 py-5 text-[var(--color-text-subtle)]">
            <h3 className="mb-2 text-sm font-medium text-[var(--color-text-muted)]">
              Tasks
            </h3>
            <p className="m-0 text-xs">마감이 임박한 할 일 TOP 3.</p>
          </div>
        </aside>
      </div>

      <footer className="mt-12 flex items-center justify-between border-t border-[var(--color-hairline)] pt-4 text-xs text-[var(--color-text-subtle)]">
        <PushSubscribeButton />
        <a
          href="https://mail.google.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--color-text-muted)] hover:underline hover:underline-offset-2"
        >
          Gmail에서 보기 →
        </a>
      </footer>
    </main>
  );
}
