// 글로벌 네비게이션 데이터 (순수 — JSX/client 의존 없음).
// 신규 라우트 추가 = 여기 한 줄 + icons.tsx 아이콘 1개 + navIcon.tsx 매핑 1줄.
export type NavIconKey =
  | "home"
  | "chart"
  | "skill"
  | "fortune"
  | "tiger"
  | "server";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIconKey;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "홈", icon: "home" },
  { href: "/stocks", label: "주식", icon: "chart" },
  { href: "/skills", label: "스킬", icon: "skill" },
  { href: "/fortune", label: "운세", icon: "fortune" },
  { href: "/tiger", label: "호상담", icon: "tiger" },
  // { href: "/servers", label: "서버", icon: "server" }, // 인덱스 라우트 미존재 — Task 8에서 신설 후 활성화
];
