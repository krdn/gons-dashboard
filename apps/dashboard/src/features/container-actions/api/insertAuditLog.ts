// 컨테이너 액션 감사 로그 삽입 — Server Actions에서 호출.
// Task 14의 restart/start/stop이 try/catch 양 분기에서 모두 호출 (성공/실패 기록).
// 별도 unit test는 만들지 않고 Task 14 integration test에서 검증.
import "server-only";
import { db } from "@/shared/lib/db/client";
import { auditLogs } from "@/shared/lib/db/schema";

export type AuditInput = {
  hostId: string;
  containerId: string;
  containerName: string;
  action: "restart" | "start" | "stop";
  userEmail: string;
  status: "success" | "failed";
  errorMessage?: string | null;
  durationMs: number;
};

export async function insertAuditLog(input: AuditInput): Promise<void> {
  await db.insert(auditLogs).values({
    hostId: input.hostId,
    containerId: input.containerId,
    containerName: input.containerName,
    action: input.action,
    userEmail: input.userEmail,
    status: input.status,
    errorMessage: input.errorMessage ?? null,
    durationMs: input.durationMs,
  });
}
