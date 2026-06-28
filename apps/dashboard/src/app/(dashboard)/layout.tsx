// 인증 셸 그룹의 RSC layout. cookies()로 사이드바 collapse 초기값을 읽어
// client ShellLayout에 주입(hydration flash 회피). page 트리는 children slot으로
// 주입되어 서버 렌더 유지(위젯 postgres 의존 무손상).
// auth 가드는 넣지 않는다 — 공유 layout은 soft-nav에서 재렌더 안 됨(per-page redirect 유지).
import { cookies } from "next/headers";
import { ShellLayout } from "@/widgets/app-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const collapsed = (await cookies()).get("sidebar_collapsed")?.value === "1";
  return <ShellLayout initialCollapsed={collapsed}>{children}</ShellLayout>;
}
