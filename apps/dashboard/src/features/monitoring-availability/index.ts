// 가용성(HTTP)·SSL 만료 관제 오케스트레이션 — server 전용 진입점.
// 호출: app/api/cron/check-http (매분), app/api/cron/check-ssl (매일).
import "server-only";
import { env } from "@/shared/config/env";
import {
  getRecentChecks,
  insertCheckResults,
  recordEvent,
  resolveEvent,
} from "@/entities/monitoring/server";
import { MONITORED_SITES, type SiteCheck } from "./config/sites";
import { probeSite } from "./lib/probeSite";
import {
  HTTP_FAIL_STREAK_FOR_CRITICAL,
  judgeHttp,
  judgeSsl,
} from "./lib/judgeAvailability";

export { MONITORED_SITES, type SiteCheck };

export interface HttpCheckSummary {
  status: "ok" | "warning" | "critical";
  httpStatus?: number;
  latencyMs: number;
}

export async function runHttpCheck(site: SiteCheck): Promise<HttpCheckSummary> {
  const probe = await probeSite({
    domain: site.domain,
    path: site.path,
    connectIp: env.HTTP_CHECK_CONNECT_IP,
  });

  // 직전 (streak-1)회만 있으면 3연속 판정 가능 — 이번 결과 insert 전에 조회.
  const previous = await getRecentChecks(
    "http",
    site.domain,
    HTTP_FAIL_STREAK_FOR_CRITICAL - 1,
  );
  const status = judgeHttp(
    probe.up,
    previous.map((r) => r.status),
  );

  await insertCheckResults([
    {
      kind: "http",
      target: site.domain,
      status,
      detail: {
        latencyMs: probe.latencyMs,
        ...(probe.httpStatus != null ? { httpStatus: probe.httpStatus } : {}),
        ...(probe.error != null ? { error: probe.error } : {}),
      },
    },
  ]);

  const dedupKey = `http:${site.domain}`;
  if (status === "critical") {
    await recordEvent({
      source: "http",
      severity: "critical",
      title: `${site.domain} 응답 없음 (${HTTP_FAIL_STREAK_FOR_CRITICAL}연속 실패)`,
      detail: probe.error ?? `HTTP ${probe.httpStatus ?? "?"}`,
      dedupKey,
    });
  } else if (status === "ok") {
    await resolveEvent(dedupKey);
  }
  // warning(단발 실패): row 만 — 이벤트 없음 (플래핑 소음 억제).

  return {
    status,
    ...(probe.httpStatus != null ? { httpStatus: probe.httpStatus } : {}),
    latencyMs: probe.latencyMs,
  };
}

export interface SslCheckSummary {
  status: "ok" | "warning" | "critical" | "unknown";
  daysLeft?: number;
}

export async function runSslCheck(site: SiteCheck): Promise<SslCheckSummary> {
  const probe = await probeSite({
    domain: site.domain,
    path: "/",
    connectIp: env.HTTP_CHECK_CONNECT_IP,
  });

  // TLS 자체가 실패하면 인증서 정보 없음 — 다운 자체는 HTTP 체크(매분)가
  // 잡으므로 여기선 unknown row 만 남긴다.
  if (probe.certDaysLeft == null) {
    await insertCheckResults([
      {
        kind: "ssl",
        target: site.domain,
        status: "unknown",
        detail: probe.error != null ? { error: probe.error } : {},
      },
    ]);
    return { status: "unknown" };
  }

  const daysLeft = probe.certDaysLeft;
  const status = judgeSsl(daysLeft);
  await insertCheckResults([
    { kind: "ssl", target: site.domain, status, detail: { daysLeft } },
  ]);

  const dedupKey = `ssl:${site.domain}`;
  if (status === "ok") {
    await resolveEvent(dedupKey);
  } else {
    await recordEvent({
      source: "ssl",
      severity: status,
      title: `${site.domain} 인증서 만료 D-${daysLeft}`,
      dedupKey,
    });
  }

  return { status, daysLeft };
}
