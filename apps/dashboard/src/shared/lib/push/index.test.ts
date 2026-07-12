import { beforeEach, describe, expect, it, vi } from "vitest";

const sendNotificationMock = vi.hoisted(() => vi.fn());
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: sendNotificationMock },
}));

// mutable env — ensureVapid의 모듈 캐시(vapidConfigured)는 성공 후에만 true가 되므로
// vapid-missing 테스트를 "먼저" 실행하고 그 뒤 키를 채운다 (파일 내 순서 의존, 의도적).
const envMock = vi.hoisted(() => ({
  VAPID_PUBLIC_KEY: "",
  VAPID_PRIVATE_KEY: "",
  VAPID_SUBJECT: "",
}));
vi.mock("@/shared/config/env", () => ({ env: envMock }));

const subsFixture = vi.hoisted(() => ({ rows: [] as Array<Record<string, string>> }));
const deleteWhereMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/shared/lib/db/client", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => subsFixture.rows }) }),
    delete: () => ({ where: deleteWhereMock }),
  },
}));

import { sendPushToUser } from "./index";

function sub(endpoint: string) {
  return { endpoint, p256dh: "k", auth: "a" };
}

beforeEach(() => {
  sendNotificationMock.mockReset().mockResolvedValue(undefined);
  deleteWhereMock.mockClear();
  subsFixture.rows = [];
});

describe("sendPushToUser", () => {
  it("VAPID env 미설정이면 첫 구독에서 중단 — 발송·삭제 없음 (이 테스트가 먼저 실행돼야 함)", async () => {
    subsFixture.rows = [sub("a"), sub("b")];
    const r = await sendPushToUser("u1", { title: "t", body: "b" });
    expect(r).toEqual({ total: 2, sent: 0, expired: 0, errors: 0 });
    expect(sendNotificationMock).not.toHaveBeenCalled();
    expect(deleteWhereMock).not.toHaveBeenCalled();
  });

  it("전 구독 성공 — 카운트 정확, 삭제 없음", async () => {
    envMock.VAPID_PUBLIC_KEY = "pub";
    envMock.VAPID_PRIVATE_KEY = "priv";
    envMock.VAPID_SUBJECT = "mailto:test@example.com";
    subsFixture.rows = [sub("a"), sub("b")];

    const r = await sendPushToUser("u1", { title: "t", body: "b" });
    expect(r).toEqual({ total: 2, sent: 2, expired: 0, errors: 0 });
    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
    expect(deleteWhereMock).not.toHaveBeenCalled();
  });

  it("만료(410) 구독은 expired 집계 + DB 삭제 1회", async () => {
    subsFixture.rows = [sub("live"), sub("dead")];
    sendNotificationMock.mockImplementation(async (target: { endpoint: string }) => {
      if (target.endpoint === "dead") {
        throw Object.assign(new Error("gone"), { statusCode: 410 });
      }
    });

    const r = await sendPushToUser("u1", { title: "t", body: "b" });
    expect(r).toEqual({ total: 2, sent: 1, expired: 1, errors: 0 });
    expect(deleteWhereMock).toHaveBeenCalledTimes(1);
  });

  it("일반 에러는 errors 집계 — 삭제하지 않는다 (일시 장애일 수 있음)", async () => {
    subsFixture.rows = [sub("a")];
    sendNotificationMock.mockRejectedValue(new Error("network"));

    const r = await sendPushToUser("u1", { title: "t", body: "b" });
    expect(r).toEqual({ total: 1, sent: 0, expired: 0, errors: 1 });
    expect(deleteWhereMock).not.toHaveBeenCalled();
  });

  it("구독 0건은 에러 아님 — 조용히 total 0", async () => {
    const r = await sendPushToUser("u1", { title: "t", body: "b" });
    expect(r).toEqual({ total: 0, sent: 0, expired: 0, errors: 0 });
  });
});
