"use client";
import { useMemo, useState } from "react";
import type { MaintenanceEntry } from "../model/types";
import { CopyableCommand } from "./CopyableCommand";

export function MaintenanceIndex({ entries }: { entries: MaintenanceEntry[] }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return entries;
    return entries.filter((e) =>
      [e.task, e.where, e.how, e.command ?? "", e.warning ?? ""].some((s) =>
        s.toLowerCase().includes(t),
      ),
    );
  }, [q, entries]);
  return (
    <div className="space-y-3">
      <input
        type="search"
        aria-label="유지보수 작업 검색"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="유지보수 작업 검색…"
        className="w-full rounded-md border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)]"
      />
      <ul className="space-y-3">
        {filtered.map((e, i) => (
          <li
            key={i}
            className="space-y-1 rounded-md border border-[var(--color-hairline)] p-3"
          >
            <p className="font-medium text-[var(--color-text)]">{e.task}</p>
            <p className="text-xs text-[var(--color-text-muted)]">
              {e.where} — {e.how}
            </p>
            {e.warning && <p className="text-xs">⚠️ {e.warning}</p>}
            {e.command && <CopyableCommand command={e.command} />}
          </li>
        ))}
      </ul>
    </div>
  );
}
