// 글로벌 네비게이션 데이터 (순수 — JSX/client 의존 없음).
// 신규 라우트 추가 = 여기 한 줄 + icons.tsx 아이콘 1개 + navIcon.tsx 매핑 1줄.
export type NavIconKey =
  | "home"
  | "chart"
  | "skill"
  | "plugin"
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
  { href: "/plugins", label: "플러그인", icon: "plugin" },
  { href: "/fortune", label: "운세", icon: "fortune" },
  { href: "/tiger", label: "호상담", icon: "tiger" },
  // { href: "/servers", label: "서버", icon: "server" }, // /servers 인덱스 라우트 미존재(servers/[hostName] 동적 라우트만 있음). 인덱스 신설 시 활성화.
];
