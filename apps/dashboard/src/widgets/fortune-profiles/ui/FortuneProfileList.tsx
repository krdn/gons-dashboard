"use client";

import { useState } from "react";
import type { FortuneProfile } from "@/entities/fortune-profile/client";
import { FortuneProfileCard } from "./FortuneProfileCard";
import { FortuneProfileEmpty } from "./FortuneProfileEmpty";
import { FortuneProfileForm } from "./FortuneProfileForm";

export function FortuneProfileList({
  profiles,
}: {
  profiles: FortuneProfile[];
}) {
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--color-text-subtle)]">
          총 {profiles.length}명
        </p>
        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded bg-[var(--color-accent)] px-4 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            + 새 프로필
          </button>
        )}
      </div>

      {creating && (
        <article className="rounded-xl border border-[var(--color-accent)] bg-[var(--color-surface)] p-5">
          <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-muted)]">
            새 프로필 추가
          </h3>
          <FortuneProfileForm
            mode="create"
            onDone={() => setCreating(false)}
          />
        </article>
      )}

      {profiles.length === 0 && !creating ? (
        <FortuneProfileEmpty />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {profiles.map((p) => (
            <FortuneProfileCard key={p.id} profile={p} />
          ))}
        </div>
      )}
    </div>
  );
}
