import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import { getSkills } from "@/entities/skill/server";
import { SkillCatalog } from "@/widgets/skill-catalog";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const skills = getSkills();

  return (
    <main className="mx-auto w-full max-w-[1240px] px-6 py-12">
      <header className="mb-8">
        <Link
          href="/"
          className="text-xs text-[var(--color-text-subtle)] hover:underline"
        >
          ← 대시보드로
        </Link>
        <h1 className="mt-2 text-display font-bold tracking-tight">
          Claude Code 스킬
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          설치된 스킬의 사용법과 출처를 살펴봅니다 ({skills.length}개).
        </p>
      </header>
      <SkillCatalog skills={skills} />
    </main>
  );
}
