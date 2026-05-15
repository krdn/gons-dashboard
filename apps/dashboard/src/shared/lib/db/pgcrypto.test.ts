import { describe, expect, it } from "vitest";
import { encryptToken, decryptToken } from "./pgcrypto";

describe("token encryption helpers", () => {
  it("encryptToken returns Buffer with non-empty content", () => {
    const buf = encryptToken("hello", "0".repeat(32));
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("decryptToken roundtrip", () => {
    const key = "test-encryption-key-32-bytes-long!";
    const original = "secret-access-token-abc123";
    const enc = encryptToken(original, key);
    const dec = decryptToken(enc, key);
    expect(dec).toBe(original);
  });

  it("decryptToken with wrong key throws", () => {
    const enc = encryptToken("payload", "0".repeat(32));
    expect(() => decryptToken(enc, "wrong-key-".repeat(4))).toThrow();
  });
});
