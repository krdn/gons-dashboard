"use server";
import "server-only";
import { auth } from "@/shared/lib/auth";
import { cleanupTranscript, type CleanupResult } from "../lib/cleanup-transcript";

// ⚠️ "use server" 파일에서 import한 타입의 재-export(`export type { X };`)는 금지 —
// server-action 변환이 export 이름에 런타임 참조를 만들어 ReferenceError로 모듈이 죽는다.
// 타입은 원 선언지(../lib/cleanup-transcript)에서 직접 가져갈 것 (client.ts 참조).
export async function cleanupTranscriptAction(raw: string): Promise<CleanupResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return cleanupTranscript(raw);
}
