import { describe, it, expect } from "vitest";
import { extractBodyText, type GmailPayload } from "./mime";

const b64url = (s: string) =>
  Buffer.from(s, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

describe("extractBodyText", () => {
  it("text/plain 단일 파트", () => {
    const p: GmailPayload = {
      mimeType: "text/plain",
      body: { data: b64url("안녕하세요 본문입니다") },
    };
    expect(extractBodyText(p)).toBe("안녕하세요 본문입니다");
  });

  it("multipart/alternative — text/plain 우선", () => {
    const p: GmailPayload = {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64url("plain 우선") } },
        { mimeType: "text/html", body: { data: b64url("<p>html 무시</p>") } },
      ],
    };
    expect(extractBodyText(p)).toBe("plain 우선");
  });

  it("text/html only → 태그 제거", () => {
    const p: GmailPayload = {
      mimeType: "text/html",
      body: { data: b64url("<p>안녕<br>하세요</p>") },
    };
    expect(extractBodyText(p)).toContain("안녕");
    expect(extractBodyText(p)).not.toContain("<p>");
  });

  it("인용부(> ...) 절단", () => {
    const p: GmailPayload = {
      mimeType: "text/plain",
      body: { data: b64url("내 답변\n\nOn 2026 someone wrote:\n> 이전 메일") },
    };
    const out = extractBodyText(p);
    expect(out).toContain("내 답변");
    expect(out).not.toContain("이전 메일");
  });

  it("빈 payload → 빈 문자열", () => {
    expect(extractBodyText({ mimeType: "text/plain" })).toBe("");
  });
});
