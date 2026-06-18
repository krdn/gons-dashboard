// markAsReplied/dismissThread 가 ActionResult 유니온을 반환하는가 (throw 금지).
// ReplyCard 의 runAction 은 result.ok 분기에 의존하므로, 이 두 액션이
// 실패 시 throw 하면 client 에서 unhandled rejection 으로 터진다.
// 핵심 단언: unauthorized·db-error 모두 reason 반환 + throw 안 함.
import { describe, it, expect, vi, beforeEach } from "vitest";

const auth = vi.fn();
vi.mock("@/shared/lib/auth", () => ({
  auth: () => auth(),
}));

// db.update 체인 — 기본은 성공(undefined resolve), 케이스별로 throw 주입.
const updateWhere = vi.fn(async () => undefined);
vi.mock("@/shared/lib/db/client", () => ({
  db: {
    update: () => ({ set: () => ({ where: () => updateWhere() }) }),
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const loggerError = vi.fn();
vi.mock("@/shared/lib/log", () => ({
  logger: { error: (...args: unknown[]) => loggerError(...args) },
}));

import { markAsReplied, unmarkReplied } from "@/features/email-analysis/api/markAsReplied";
import { dismissThread } from "@/features/email-analysis/api/dismissThread";

beforeEach(() => {
  auth.mockReset();
  updateWhere.mockReset();
  updateWhere.mockResolvedValue(undefined);
  loggerError.mockReset();
});

const actions = [
  { name: "markAsReplied", fn: markAsReplied },
  { name: "unmarkReplied", fn: unmarkReplied },
  { name: "dismissThread", fn: dismissThread },
];

describe.each(actions)("$name — ActionResult 계약", ({ fn }) => {
  it("로그인 안 됨 → {ok:false, reason:'unauthorized'} (throw 안 함)", async () => {
    auth.mockResolvedValue(null);
    const result = await fn("t1");
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
    expect(updateWhere).not.toHaveBeenCalled();
  });

  it("정상 → {ok:true}", async () => {
    auth.mockResolvedValue({ user: { id: "u1" } });
    const result = await fn("t1");
    expect(result).toEqual({ ok: true });
    expect(updateWhere).toHaveBeenCalledOnce();
  });

  it("DB update throw → {ok:false, reason:'db-error'} + logger.error (throw 전파 안 함)", async () => {
    auth.mockResolvedValue({ user: { id: "u1" } });
    updateWhere.mockRejectedValueOnce(new Error("connection lost"));
    const result = await fn("t1");
    expect(result).toEqual({ ok: false, reason: "db-error" });
    expect(loggerError).toHaveBeenCalledOnce();
  });
});
