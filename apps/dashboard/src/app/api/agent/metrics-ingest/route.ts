// /api/agent/metrics-ingest — 호스트 에이전트(scripts/monitoring-agent)의
// vitals 수집 입구. 이슈 #323 Phase 1.
//
// 정책 (memo-ingest 와 동일 골격):
//   - Bearer 인증 (env.METRICS_INGEST_TOKEN — mediator 토큰과 분리).
//   - zod 검증 실패는 400, 미등록 host 는 404.
//   - 임계값 평가·이벤트 기록은 ingestVitals 내부에서 best-effort.
//   - rate limiting 없음 (단일 서버 에이전트 + Bearer 필수).
import "server-only";
import { env } from "@/shared/config/env";
import { verifyBearer } from "@/shared/lib/auth/cron";
import {
  ingestVitals,
  vitalsPayloadSchema,
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
  const parsed = vitalsPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return new Response("Invalid body", { status: 400, headers: NO_STORE });
  }

  try {
    const { inserted } = await ingestVitals(parsed.data);
    return Response.json({ inserted }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof UnknownHostError) {
      return new Response("Unknown host", { status: 404, headers: NO_STORE });
    }
    console.error("[metrics-ingest] 저장 실패", err);
    return Response.json(
      { error: "Transient error" },
      { status: 500, headers: NO_STORE },
    );
  }
}
