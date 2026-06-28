// 글로벌 네비게이션 데이터 (순수 — JSX/client 의존 없음).
// 구조: 최상위는 잎(단독 링크) 또는 그룹(펼침/접힘 부모). 그룹은 잎만 자식으로 가진다(2단계).
// 신규 라우트 추가 = 여기 한 줄 + icons.tsx 아이콘 1개 + navIcon.tsx 매핑 1줄.
export type NavIconKey =
  | "home"
  | "chart"
  | "skill"
  | "plugin"
  | "agent"
  | "fortune"
  | "tiger"
  | "claude"
  | "personal"
  | "server";

// 잎 노드 — 실제 라우트로 가는 링크
export interface NavLeaf {
  kind: "leaf";
  href: string;
  label: string;
  icon: NavIconKey;
}

// 그룹 노드 — 클릭 시 자식을 펼치고 접는 부모 (링크 아님)
export interface NavGroup {
  kind: "group";
  id: string; // 토글 상태 추적용 안정 키
  label: string;
  icon: NavIconKey;
  children: NavLeaf[];
}

export type NavNode = NavLeaf | NavGroup;

export const NAV_TREE: NavNode[] = [
  { kind: "leaf", href: "/", label: "홈", icon: "home" },
  {
    kind: "group",
    id: "claude-code",
    label: "Claude Code",
    icon: "claude",
    children: [
      { kind: "leaf", href: "/skills", label: "스킬", icon: "skill" },
      { kind: "leaf", href: "/plugins", label: "플러그인", icon: "plugin" },
      { kind: "leaf", href: "/agents", label: "에이전트", icon: "agent" },
    ],
  },
  {
    kind: "group",
    id: "personal",
    label: "개인",
    icon: "personal",
    children: [
      { kind: "leaf", href: "/stocks", label: "주식", icon: "chart" },
      { kind: "leaf", href: "/fortune", label: "운세", icon: "fortune" },
      { kind: "leaf", href: "/tiger", label: "호상담", icon: "tiger" },
      // { kind: "leaf", href: "/servers", label: "서버", icon: "server" }, // /servers 인덱스 라우트 미존재(servers/[hostName] 동적 라우트만). 인덱스 신설 시 활성화.
    ],
  },
];
