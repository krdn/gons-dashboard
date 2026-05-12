// gons-mcp-calendar — Claude Code stdio 진입점.
//
// 환경변수:
//   MCP_DASHBOARD_URL — 예: https://gons.krdn.kr
//   MCP_DASHBOARD_TOKEN — apps/dashboard와 사전 공유된 bearer
//
// 흐름: env 검증 → token fetcher 합성 → getUpcomingEvents tool 정의 → stdio listen.
import { fetchAccessToken, listUpcomingEvents } from "@gons/shared-google";
import { runStdioServer } from "@gons/shared-mcp-runtime";
import { makeGetUpcomingEventsTool } from "./tools/get-upcoming-events";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    console.error(`[gons-mcp-calendar] missing env: ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const dashboardUrl = requireEnv("MCP_DASHBOARD_URL").replace(/\/$/, "");
  const bearer = requireEnv("MCP_DASHBOARD_TOKEN");
  const mediatorUrl = `${dashboardUrl}/api/mcp/credentials/google`;

  const getAccessToken = async () => {
    const { accessToken } = await fetchAccessToken({ mediatorUrl, bearer });
    return accessToken;
  };

  const getUpcoming = makeGetUpcomingEventsTool({
    getAccessToken,
    listFn: listUpcomingEvents,
  });

  await runStdioServer({
    name: "gons-mcp-calendar",
    version: "0.1.0",
    tools: [getUpcoming],
  });
}

main().catch((err) => {
  console.error("[gons-mcp-calendar] fatal:", err);
  process.exit(1);
});
