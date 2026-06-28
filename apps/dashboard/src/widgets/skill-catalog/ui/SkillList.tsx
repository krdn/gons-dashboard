"use client";
import { SOURCE_LABEL, type SkillMeta } from "@/entities/skill/client";

export function SkillList({
  skills,
  selectedName,
  onSelect,
}: {
  skills: SkillMeta[];
  selectedName: string | null;
  onSelect: (name: string) => void;
}) {
  if (skills.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-[var(--color-hairline)] p-4 text-sm text-[var(--color-text-muted)]">
        조건에 맞는 스킬이 없습니다.
      </p>
    );
  }
  return (
    <ul role="list" className="flex flex-col gap-1">
      {skills.map((s) => {
        const active = s.name === selectedName;
        return (
          <li key={s.name}>
            <button
              type="button"
              onClick={() => onSelect(s.name)}
              aria-current={active ? "true" : undefined}
              className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                active
                  ? "border-[var(--color-accent)] bg-[var(--color-surface-2)]"
                  : "border-transparent hover:border-[var(--color-hairline)] hover:bg-[var(--color-surface-2)]"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-[var(--color-text)]">
                  {s.name}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-[var(--color-text-subtle)]">
                  {SOURCE_LABEL[s.source]}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">
                {s.description}
              </p>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
