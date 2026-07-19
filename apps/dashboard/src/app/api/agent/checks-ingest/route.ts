// /api/agent/checks-ingest — 호스트 에이전트의 판정형 점검(systemd 서비스/타이머·
// 호스트 cron 관찰치) 입구. 이슈 #323 Phase 2. metrics-ingest 와 동일 골격·토큰.
import "server-only";
import { env } from "@/shared/config/env";
import { verifyBearer } from "@/shared/lib/auth/cron";
import {
  ingestChecks,
  checksPayloadSchema,
  UnknownHostError,
} from "@/features/monitoring-ingest";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(req: Request) {
  if (!verifyBearer(req, env.METRICS_INGEST_TOKEN)) {
    return new Response("Unauthorized", { status: 401, headers: NO_STORE });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: NO_STORE });
  }
  const parsed = checksPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return new Response("Invalid body", { status: 400, headers: NO_STORE });
  }

  try {
    const { inserted } = await ingestChecks(parsed.data);
    return Response.json({ inserted }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof UnknownHostError) {
      return new Response("Unknown host", { status: 404, headers: NO_STORE });
    }
    console.error("[checks-ingest] 저장 실패", err);
    return Response.json(
      { error: "Transient error" },
      { status: 500, headers: NO_STORE },
    );
  }
}
