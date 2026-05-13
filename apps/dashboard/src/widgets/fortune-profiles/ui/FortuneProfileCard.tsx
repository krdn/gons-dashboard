"use client";

import Link from "next/link";
import { useState } from "react";
import {
  RELATION_LABEL,
  type FortuneProfile,
} from "@/entities/fortune-profile/model/types";
import { FortuneProfileForm } from "./FortuneProfileForm";

export function FortuneProfileCard({ profile }: { profile: FortuneProfile }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <article className="rounded-xl border border-[var(--color-accent)] bg-[var(--color-surface)] p-5">
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-muted)]">
          프로필 수정
        </h3>
        <FortuneProfileForm
          mode="edit"
          profile={profile}
          onDone={() => setEditing(false)}
        />
      </article>
    );
  }

  return (
    <article className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-baseline gap-2">
            <h3 className="text-base font-semibold">{profile.name}</h3>
            {profile.nameHanja && (
              <span className="text-sm text-[var(--color-text-subtle)]">
                {profile.nameHanja}
              </span>
            )}
          </div>
          <span className="mt-0.5 inline-block rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-xs text-[var(--color-text-muted)]">
            {RELATION_LABEL[profile.relation]}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded border border-[var(--color-hairline)] px-2.5 py-1 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
        >
          수정
        </button>
      </header>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)]">
        <dt className="text-[var(--color-text-subtle)]">생년월일</dt>
        <dd className="tabular-nums">
          {profile.birthDate}{" "}
          <span className="text-[var(--color-text-subtle)]">
            ({profile.calendar === "solar" ? "양력" : "음력"})
          </span>
        </dd>
        <dt className="text-[var(--color-text-subtle)]">성별</dt>
        <dd>{profile.gender === "male" ? "남성" : "여성"}</dd>
        {profile.birthTime && (
          <>
            <dt className="text-[var(--color-text-subtle)]">출생 시각</dt>
            <dd className="tabular-nums">{profile.birthTime}</dd>
          </>
        )}
        {profile.birthCity && (
          <>
            <dt className="text-[var(--color-text-subtle)]">출생 도시</dt>
            <dd>{profile.birthCity}</dd>
          </>
        )}
      </dl>

      <footer className="mt-4 flex justify-end border-t border-[var(--color-hairline)] pt-3">
        <Link
          href={`/fortune/${profile.id}`}
          className="text-xs text-[var(--color-accent)] hover:underline"
        >
          상세보기 →
        </Link>
      </footer>
    </article>
  );
}
