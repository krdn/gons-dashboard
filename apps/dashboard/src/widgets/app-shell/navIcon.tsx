"use client";
import { type ReactNode } from "react";
import {
  HomeIcon,
  ChartIcon,
  SkillIcon,
  PluginIcon,
  AgentIcon,
  FortuneIcon,
  TigerIcon,
  ClaudeIcon,
  PersonalIcon,
  ServerIcon,
} from "@/shared/ui/icons";
import { type NavIconKey } from "@/shared/config/navigation";

const MAP: Record<NavIconKey, (p: { size?: number; className?: string }) => ReactNode> = {
  home: HomeIcon,
  chart: ChartIcon,
  skill: SkillIcon,
  plugin: PluginIcon,
  agent: AgentIcon,
  fortune: FortuneIcon,
  tiger: TigerIcon,
  claude: ClaudeIcon,
  personal: PersonalIcon,
  server: ServerIcon,
};

export function NavIcon({ icon, className }: { icon: NavIconKey; className?: string }) {
  const Cmp = MAP[icon];
  return <Cmp size={18} className={className} />;
}
