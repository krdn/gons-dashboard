// 앱 라우트 상수 — Server Action 의 revalidatePath 호출에서 사용.
//
// 문자열 하드코딩 시 라우트 변경에 누락이 생기고, 존재하지 않는 경로(예: /dashboard)
// 가 사일런트 noop 으로 작동하는 사고를 막는다.

/** 메인 대시보드 — RSC, src/app/page.tsx. */
export const ROUTE_DASHBOARD = "/" as const;

/** 호스트 상세 페이지 — dynamic, src/app/servers/[hostName]/page.tsx. */
export function routeServerDetail(hostName: string): string {
  return `/servers/${hostName}`;
}
