import { describe, it, expect, vi } from "vitest";

vi.mock("@/shared/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/shared/lib/db/client", () => ({
  db: { select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () => [] }) }) }) }) },
}));

import { sendReply } from "./sendReply";

describe("sendReply 소유권", () => {
  it("소유하지 않은 threadId → Thread not found throw", async () => {
    await expect(
      sendReply("not-owned", "본문", {
        gmailThreadId: "x", toEmail: "a@b.com", subject: "s", inReplyTo: "", references: "",
      }),
    ).rejects.toThrow("Thread not found");
  });
});
