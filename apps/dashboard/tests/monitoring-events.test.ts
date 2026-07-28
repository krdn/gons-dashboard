// 관제 이벤트 dedup·샘플 저장 통합 테스트 (test DB — TEST_DATABASE_URL 필요).
// dedupKey/host명은 per-run 프리픽스로 스코프 (host-api.test.ts 패턴).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { like, eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { hosts, monitoringEvents } from "@/shared/lib/db/schema";
import {
  recordEvent,
  resolveEvent,
  countOpenEvents,
  listRecentEvents,
} from "@/entities/monitoring/api/events";
import {
  insertMetricSamples,
  getRecentSamples,
} from "@/entities/monitoring/api/samples";

const PREFIX = `mon-test-${Date.now()}-`;
const KEY = `${PREFIX}host:x:cpu`;

async function openEvents(dedupKey: string) {
  return db
    .select()
    .from(monitoringEvents)
    .where(eq(monitoringEvents.dedupKey, dedupKey));
}

describe("monitoring events", () => {
  beforeEach(async () => {
    await db
      .delete(monitoringEvents)
      .where(like(monitoringEvents.dedupKey, `${PREFIX}%`));
  });

  it("recordEvent: open 이벤트가 없으면 insert", async () => {
    await recordEvent({
      source: "host",
      severity: "warning",
      title: "CPU 사용률 92% (임계 90%)",
      dedupKey: KEY,
    });
    const rows = await openEvents(KEY);
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe("warning");
    expect(rows[0].resolvedAt).toBeNull();
  });

  it("recordEvent: 동일 severity 재기록은 row 를 늘리지 않고 최신 내용으로 갱신", async () => {
    await recordEvent({ source: "host", severity: "warning", title: "t1", dedupKey: KEY });
    await recordEvent({ source: "host", severity: "warning", title: "t2", dedupKey: KEY });
    const rows = await openEvents(KEY);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("t2");
  });

  // 회귀 방지 (2026-07-28 실측): severity 등급을 넘지 않는 악화가 화면에 반영되지
  // 않던 결함. 포트 드리프트가 1건→3건으로 늘었는데 severity 가 warning 으로
  // 같아서, 이벤트 타임라인이 5일 전의 "1건" 을 계속 표시했다.
  it("recordEvent: severity 가 같아도 악화된 title/detail 을 반영", async () => {
    await recordEvent({
      source: "security",
      severity: "warning",
      title: "허용목록 밖 리스닝 소켓 1건: tcp:0.0.0.0:3000",
      detail: JSON.stringify({ count: 62 }),
      dedupKey: KEY,
    });
    await recordEvent({
      source: "security",
      severity: "warning",
      title: "허용목록 밖 리스닝 소켓 3건: tcp:0.0.0.0:3000 외 2건",
      detail: JSON.stringify({ count: 65 }),
      dedupKey: KEY,
    });
    const rows = await openEvents(KEY);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toContain("3건");
    expect(rows[0].detail).toBe(JSON.stringify({ count: 65 }));
  });

  // 갱신이 "새 사건" 으로 둔갑하면 안 된다 — 지속 기간(언제부터 위험했나)이 사라진다.
  it("recordEvent: 내용 갱신 후에도 occurredAt 은 최초 발생 시각", async () => {
    await recordEvent({ source: "host", severity: "warning", title: "t1", dedupKey: KEY });
    const [first] = await openEvents(KEY);
    await recordEvent({ source: "host", severity: "warning", title: "t2", dedupKey: KEY });
    const [after] = await openEvents(KEY);
    expect(after.id).toBe(first.id);
    expect(after.occurredAt.getTime()).toBe(first.occurredAt.getTime());
  });

  // 갱신이 notifiedAt 을 건드리면 sweep 이 같은 사건을 다시 알린다 (텔레그램 스팸).
  it("recordEvent: 내용 갱신이 notifiedAt 을 되돌리지 않는다", async () => {
    await recordEvent({ source: "host", severity: "warning", title: "t1", dedupKey: KEY });
    const notifiedAt = new Date("2026-07-28T00:00:00.000Z");
    await db
      .update(monitoringEvents)
      .set({ notifiedAt })
      .where(eq(monitoringEvents.dedupKey, KEY));

    await recordEvent({ source: "host", severity: "warning", title: "t2", dedupKey: KEY });
    const [row] = await openEvents(KEY);
    expect(row.title).toBe("t2");
    expect(row.notifiedAt?.getTime()).toBe(notifiedAt.getTime());
  });

  it("recordEvent: severity 변경 시 기존 open row 를 갱신 (에스컬레이션)", async () => {
    await recordEvent({ source: "host", severity: "warning", title: "warn", dedupKey: KEY });
    await recordEvent({ source: "host", severity: "critical", title: "crit", dedupKey: KEY });
    const rows = await openEvents(KEY);
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe("critical");
    expect(rows[0].title).toBe("crit");
  });

  it("동시 recordEvent 5건 → open 1건만 (partial unique index 방어)", async () => {
    await Promise.all(
      Array.from({ length: 5 }, () =>
        recordEvent({ source: "host", severity: "warning", title: "race", dedupKey: KEY }),
      ),
    );
    const rows = await openEvents(KEY);
    expect(rows.filter((r) => r.resolvedAt === null)).toHaveLength(1);
  });

  it("resolveEvent 후 재record 는 새 open row", async () => {
    await recordEvent({ source: "host", severity: "warning", title: "w", dedupKey: KEY });
    await resolveEvent(KEY);
    await recordEvent({ source: "host", severity: "warning", title: "again", dedupKey: KEY });
    const rows = await openEvents(KEY);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.resolvedAt === null)).toHaveLength(1);
  });

  it("countOpenEvents: open critical/warning 델타 집계", async () => {
    const before = await countOpenEvents();
    await recordEvent({ source: "host", severity: "critical", title: "c", dedupKey: `${KEY}-c` });
    await recordEvent({ source: "host", severity: "warning", title: "w", dedupKey: `${KEY}-w` });
    const after = await countOpenEvents();
    expect(after.critical - before.critical).toBe(1);
    expect(after.warning - before.warning).toBe(1);
  });

  it("listRecentEvents: 최신순 반환", async () => {
    await recordEvent({ source: "host", severity: "warning", title: "old", dedupKey: `${KEY}-1` });
    await recordEvent({ source: "host", severity: "warning", title: "new", dedupKey: `${KEY}-2` });
    const events = await listRecentEvents(200);
    const mine = events.filter((e) => e.dedupKey.startsWith(PREFIX));
    expect(mine.map((e) => e.title)).toEqual(["new", "old"]);
  });
});

describe("monitoring samples", () => {
  const HOST_NAME = `${PREFIX}host`;
  let hostId: string;

  beforeEach(async () => {
    await db.delete(hosts).where(like(hosts.name, `${PREFIX}%`));
    const [h] = await db
      .insert(hosts)
      .values({ name: HOST_NAME, dockerContext: "test" })
      .returning({ id: hosts.id });
    hostId = h.id;
  });

  afterAll(async () => {
    await db.delete(hosts).where(like(hosts.name, `${PREFIX}%`));
  });

  it("insertMetricSamples → getRecentSamples 왕복", async () => {
    const at = new Date();
    const inserted = await insertMetricSamples([
      { hostId, metric: "cpu.pct", value: 12.5, labels: null, collectedAt: at },
      { hostId, metric: "disk.used_pct", value: 71, labels: { mount: "/" }, collectedAt: at },
    ]);
    expect(inserted).toBe(2);

    const since = new Date(Date.now() - 60_000);
    const rows = (await getRecentSamples(since)).filter((r) => r.hostId === hostId);
    expect(rows).toHaveLength(2);
    const disk = rows.find((r) => r.metric === "disk.used_pct");
    expect(disk?.labels).toEqual({ mount: "/" });
  });

  it("insertMetricSamples: 빈 배열은 0", async () => {
    expect(await insertMetricSamples([])).toBe(0);
  });
});
