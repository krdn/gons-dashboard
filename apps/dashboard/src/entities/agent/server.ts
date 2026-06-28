// agent entity — server-only entrypoint.
// RSC, scripts 에서 사용. agent-catalog.json 은 빌드 시점에 생성된 committed 메타데이터.
// 형태: { agents: AgentMeta[] } envelope.
import "server-only";

import catalog from "./agent-catalog.json";
import type { AgentMeta, AgentCatalog } from "./model/types";

const data = catalog as AgentCatalog;

export function getAgents(): AgentMeta[] {
  return data.agents;
}

export type { AgentMeta, AgentBody, AgentSource, AgentModel } from "./model/types";
