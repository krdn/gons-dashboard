// 메인 대시보드. v0.1: Email Digest 위젯 1개.
// 와이어프레임 reference:
// ~/.gstack/projects/krdn-gons-dashboard/designs/main-dashboard-20260509/wireframe-v1.html
//
// Sprint 2.5에서 widgets/email-digest 가 이 자리를 채운다.
// 지금은 Sprint 1 골격 검증용 placeholder.

export default function DashboardPage() {
  return (
    <main className="mx-auto w-full max-w-[1240px] px-6 py-12">
      <h1 className="text-[var(--text-display)] font-bold tracking-tight">
        gons<span className="text-[var(--color-accent)]">.</span>dashboard
      </h1>
      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
        v0.1 골격 — Sprint 2에서 Email Digest 위젯이 여기 채워집니다.
      </p>
    </main>
  );
}
