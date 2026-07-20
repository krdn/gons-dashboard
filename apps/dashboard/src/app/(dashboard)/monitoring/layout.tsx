// /monitoring 공통 셸 — 탭만 담당한다.
//
// ⚠️ 인증은 여기가 아니라 각 page.tsx 에서 한다. layout 인증은 Next 에서
// 라우트별 보호를 보장하지 않는다.
import { MonitoringTabs } from "@/widgets/monitoring";

export default function MonitoringLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MonitoringTabs />
      {children}
    </>
  );
}
