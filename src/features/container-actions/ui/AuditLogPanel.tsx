import "server-only";
import { db } from "@/shared/lib/db/client";
import { auditLogs } from "@/shared/lib/db/schema";
import { desc, eq } from "drizzle-orm";

type Props = { hostId: string; limit?: number };

export async function AuditLogPanel({ hostId, limit = 5 }: Props) {
  const rows = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.hostId, hostId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-zinc-500">아직 액션 기록이 없습니다.</p>
    );
  }
  return (
    <ul className="space-y-1 text-sm">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center gap-2 font-mono">
          <time className="text-zinc-500">
            {new Date(r.createdAt).toLocaleString("ko-KR", {
              hour: "2-digit",
              minute: "2-digit",
              month: "2-digit",
              day: "2-digit",
            })}
          </time>
          <span
            className={
              r.status === "success"
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-rose-700 dark:text-rose-400"
            }
          >
            {r.action}
          </span>
          <span className="truncate">{r.containerName}</span>
          <span className="text-zinc-500">({r.userEmail})</span>
          {r.errorMessage ? (
            <span className="truncate text-rose-500">{r.errorMessage}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
