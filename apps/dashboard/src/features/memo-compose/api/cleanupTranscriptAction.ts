"use server";
import "server-only";
import { auth } from "@/shared/lib/auth";
import { cleanupTranscript, type CleanupResult } from "../lib/cleanup-transcript";

export async function cleanupTranscriptAction(raw: string): Promise<CleanupResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return cleanupTranscript(raw);
}

export type { CleanupResult };
