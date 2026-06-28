// plugin entity 타입.
// plugin 은 skill/agent/command/hook/MCP 를 묶는 컨테이너 — counts/components 로 표현.
export type PluginStatus = "active" | "dormant" | "missing";

export const STATUS_LABEL: Record<PluginStatus, string> = {
  active: "활성",
  dormant: "휴면",
  missing: "경로 없음",
};

export interface PluginComponentCounts {
  skills: number;
  agents: number;
  commands: number;
  hooks: number; // hooks.json 안의 hook command 총 개수 (0 = 없음). skills/agents/commands 와 동일 "출하 항목 수".
  mcp: boolean; // MCP 서버는 존재 여부만 (요청 범위 — hook 개수만 셈)
}

export interface PluginComponents {
  skills: string[];
  agents: string[];
  commands: string[];
}

export interface PluginMeta {
  id: string; // "superpowers@claude-plugins-official"
  name: string; // "superpowers"
  marketplace: string; // "claude-plugins-official"
  version: string;
  description: string;
  author: string;
  homepage: string;
  keywords: string[];
  enabled: boolean;
  resolved: boolean;
  counts: PluginComponentCounts;
  components: PluginComponents;
}

export interface PluginMarketplaceMeta {
  label: string;
  count: number;
}

export interface PluginCatalog {
  plugins: PluginMeta[];
  marketplaces: Record<string, PluginMarketplaceMeta>;
}
