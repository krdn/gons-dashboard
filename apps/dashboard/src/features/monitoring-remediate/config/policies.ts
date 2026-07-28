// 자동 복구 정책 선언 (이슈 #352).
//
// ⚠️ 핵심 제약: 조치 조건은 **실측값만** 쓴다. 이름·prefix·관례를 조건에
// 넣지 않는다. 2026-07-28 수동 복구에서 두 판단이 그럴듯했지만 틀렸다 —
// Redis 키를 prefix 로 "dev 잔재" 라 판단했으나 활성 독자가 있었고,
// 5433 을 "0.0.0.0 이라 위험" 이라 판단했으나 아키텍처상 필수였다.
// 실측값이 없으면 조치하지 않고 skip 한다.

/** 재시작 시 데이터 손실·작업 유실 위험이 있는 서비스 (부분 문자열 매칭). */
export const RESTART_EXCLUDED: readonly string[] = [
  "postgres",
  "redis",
  "mongodb",
  "timescaledb",
];

/** Redis maxmemory 절대 상한 — 이 이상은 사람이 판단한다. */
export const REDIS_MAX_CAP_BYTES = 4 * 1024 ** 3;

/** Docker container ID 형식 (short=12, full=64). path traversal 방어. */
const CONTAINER_ID_RE = /^[a-f0-9]{12,64}$/;

export type RemediationAction =
  | { kind: "restart-container"; hostId: string; containerId: string; containerName: string }
  | { kind: "prune-images"; hostId: string }
  | { kind: "raise-redis-maxmemory"; hostId: string; target: string; nextBytes: number };

export type OpenEventView = {
  id: string;
  dedupKey: string;
  severity: string;
  source: string;
  title: string;
  detail: string | null;
  occurredAt: Date;
  hostId: string | null;
};

/** 조치 직전 실측한 사실. 선언 시점의 가정을 신뢰하지 않는다. */
export type LiveFacts = {
  /** 호스트 가용 메모리. 관측 실패 시 null — 그 경우 메모리 조치는 skip. */
  hostAvailableMemBytes: number | null;
  containerExcluded: (containerName: string) => boolean;
};

export type BuildResult = RemediationAction | { skip: string };

export type RemediationPolicy = {
  id: string;
  maxAttempts: number;
  cooldownMinutes: number;
  buildAction: (event: OpenEventView, facts: LiveFacts) => BuildResult;
};

function parseDetail(detail: string | null): Record<string, unknown> | null {
  if (detail == null) return null;
  try {
    const parsed: unknown = JSON.parse(detail);
    return typeof parsed === "object" && parsed != null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const restartContainer: RemediationPolicy = {
  id: "restart-container",
  maxAttempts: 2,
  cooldownMinutes: 30,
  buildAction: (event, facts) => {
    if (event.hostId == null) return { skip: "hostId 없음" };
    const d = parseDetail(event.detail);
    if (d == null) return { skip: "detail 파싱 불가 — 실측값 없이 조치 금지" };

    const name = typeof d.containerName === "string" ? d.containerName : null;
    const id = typeof d.containerId === "string" ? d.containerId : null;
    if (name == null || id == null) return { skip: "컨테이너 식별자 누락" };
    if (!CONTAINER_ID_RE.test(id)) return { skip: "containerId 형식 불일치" };
    if (facts.containerExcluded(name)) {
      return { skip: `재시작 제외목록 대상 (${name})` };
    }

    return { kind: "restart-container", hostId: event.hostId, containerId: id, containerName: name };
  },
};

const pruneImages: RemediationPolicy = {
  id: "prune-images",
  maxAttempts: 1,
  cooldownMinutes: 24 * 60,
  buildAction: (event) => {
    if (event.hostId == null) return { skip: "hostId 없음" };
    const d = parseDetail(event.detail);
    if (d == null) return { skip: "detail 파싱 불가 — 실측값 없이 조치 금지" };
    const pct = typeof d.usedPct === "number" ? d.usedPct : null;
    if (pct == null) return { skip: "디스크 사용률 관측값 없음" };
    if (pct < 85) return { skip: `임계 미달 (${pct}% < 85%)` };
    return { kind: "prune-images", hostId: event.hostId };
  },
};

const redisMaxmemory: RemediationPolicy = {
  id: "redis-maxmemory",
  maxAttempts: 2,
  cooldownMinutes: 6 * 60,
  buildAction: (event, facts) => {
    if (event.hostId == null) return { skip: "hostId 없음" };
    const d = parseDetail(event.detail);
    if (d == null) return { skip: "detail 파싱 불가 — 실측값 없이 조치 금지" };

    // noeviction 이 아니면 상한 도달 시 축출로 정상 동작한다 — 조치 불필요.
    if (d.evictionPolicy !== "noeviction") {
      return { skip: `noeviction 아님 (${String(d.evictionPolicy)})` };
    }
    const target = typeof d.target === "string" ? d.target : null;
    const maxMem = typeof d.maxMemBytes === "number" ? d.maxMemBytes : null;
    if (target == null || maxMem == null || maxMem <= 0) {
      return { skip: "target/maxMemBytes 관측값 없음" };
    }

    const nextBytes = maxMem * 2;
    if (nextBytes > REDIS_MAX_CAP_BYTES) {
      return { skip: `절대 상한 초과 (${nextBytes} > ${REDIS_MAX_CAP_BYTES})` };
    }
    // 호스트 여유를 모르면 조치하지 않는다 — 상한만 올리다 호스트가 OOM 난다.
    const avail = facts.hostAvailableMemBytes;
    const delta = nextBytes - maxMem;
    if (avail == null || avail < delta * 2) {
      return { skip: `호스트 여유 메모리 부족/불명 (필요 ${delta * 2}, 가용 ${String(avail)})` };
    }

    return { kind: "raise-redis-maxmemory", hostId: event.hostId, target, nextBytes };
  },
};

export const POLICIES: readonly RemediationPolicy[] = [
  restartContainer,
  pruneImages,
  redisMaxmemory,
];
