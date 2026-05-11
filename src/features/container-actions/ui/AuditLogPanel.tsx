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
      <p className="text-sm text-[var(--color-text-subtle)]">
        아직 액션 기록이 없습니다.
      </p>
    );
  }
  return (
    <ul className="space-y-2 text-sm">
      {rows.map((r) => (
        <li
          key={r.id}
          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-[var(--color-surface-2)] px-3 py-2 font-mono"
        >
          <time className="text-[var(--color-text-subtle)]">
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
                ? "text-emerald-700"
                : "text-[var(--color-severity-high)]"
            }
          >
            {r.action}
          </span>
          <span className="truncate text-[var(--color-text)]">
            {r.containerName}
          </span>
          <span className="text-[var(--color-text-subtle)]">({r.userEmail})</span>
          {r.errorMessage ? (
            <span className="truncate text-[var(--color-severity-high)]">{r.errorMessage}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
