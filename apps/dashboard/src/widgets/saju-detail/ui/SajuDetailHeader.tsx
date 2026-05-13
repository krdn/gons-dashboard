import Link from "next/link";
import type { FortuneProfile } from "@/entities/fortune-profile";
import { RELATION_LABEL } from "@/entities/fortune-profile";

export interface SajuDetailHeaderProps {
  profile: FortuneProfile;
}

export function SajuDetailHeader({ profile }: SajuDetailHeaderProps) {
  return (
    <header className="mb-8">
      <nav className="mb-3 flex items-center gap-3 text-xs text-[var(--color-text-subtle)]">
        <Link href="/" className="hover:underline">대시보드</Link>
        <span>·</span>
        <Link href="/fortune" className="hover:underline">사주 프로필</Link>
      </nav>
      <h1 className="text-display font-bold tracking-tight">
        {profile.name}
        {profile.nameHanja && (
          <span
            className="ml-2 text-[var(--color-text-muted)]"
            style={{ fontFamily: "var(--font-hanja)" }}
            lang="ko-Hani"
          >
            {profile.nameHanja}
          </span>
        )}
      </h1>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        {RELATION_LABEL[profile.relation]} · {profile.birthDate}
        {profile.birthTime ? ` ${profile.birthTime}` : " 시각 미상"}
        {" · "}
        {profile.calendar === "solar" ? "양력" : "음력"}
        {" · "}
        {profile.gender === "male" ? "남자" : "여자"}
      </p>
    </header>
  );
}
