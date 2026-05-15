import { createHash } from "node:crypto";

export interface ProfileHashInput {
  birthDate: string;
  calendar: string;
  gender: string;
  birthTime: string | null;
  birthCity: string | null;
}

export function computeProfileInputHash(input: ProfileHashInput): string {
  const parts = [
    input.birthDate,
    input.calendar,
    input.gender,
    input.birthTime ?? "",
    input.birthCity ?? "",
  ];
  return createHash("sha256").update(parts.join("|"), "utf8").digest("hex");
}

export function computePairInputHash(hashA: string, hashB: string): string {
  const [first, second] = [hashA, hashB].sort();
  return createHash("sha256").update(`${first}|${second}`, "utf8").digest("hex");
}
