import { createHash } from "node:crypto";
import type { ComputeSajuInput } from "./types";

export function hashProfile(input: ComputeSajuInput): string {
  const normalized = [
    input.birthDate,
    input.birthTime ?? "",
    input.calendar,
    input.gender,
    (input.birthCity ?? "").trim().toLowerCase(),
  ].join("|");
  return createHash("sha256").update(normalized).digest("hex");
}
