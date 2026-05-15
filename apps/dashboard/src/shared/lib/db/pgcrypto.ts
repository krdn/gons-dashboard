import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

// AES-256-GCM 으로 application-side 암호화. DB column 은 bytea 만 저장.
// PG_ENCRYPTION_KEY 는 hex 32 bytes 권장 — sha256 으로 정규화.
//
// 포맷: iv(12B) || authTag(16B) || ciphertext
//
// 참고: pgcrypto extension 자체는 마이그레이션의 CREATE EXTENSION 으로
// 활성화하지만, 토큰 암호화는 application 측이 명시적으로 처리. 이유:
// pgp_sym_encrypt 는 키를 SQL 인자로 전달 → query log 노출 위험.

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function deriveKey(input: string): Buffer {
  return createHash("sha256").update(input, "utf8").digest();
}

export function encryptToken(plaintext: string, keyMaterial: string): Buffer {
  const key = deriveKey(keyMaterial);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

export function decryptToken(blob: Buffer, keyMaterial: string): string {
  if (blob.length < IV_LEN + TAG_LEN) {
    throw new Error("decryptToken: blob too short");
  }
  const key = deriveKey(keyMaterial);
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = blob.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
