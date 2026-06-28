import Link from "next/link";
import { redirect } from "next/navigation";
import { listFortuneProfiles } from "@/entities/fortune-profile/server";
import { auth } from "@/shared/lib/auth";
import { FortuneProfileList } from "@/widgets/fortune-profiles";

export const dynamic = "force-dynamic";

export default async function FortunePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const profiles = await listFortuneProfiles(session.user.id);

  return (
    <main className="mx-auto w-full max-w-[900px] px-6 py-12">
      <header className="mb-8">
        <Link
          href="/"
          className="text-xs text-[var(--color-text-subtle)] hover:underline"
        >
          ← 대시보드로
        </Link>
        <h1 className="mt-2 text-display font-bold tracking-tight">
          사주 프로필
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          오늘의 운세 위젯에 표시할 사람들을 관리해요.
        </p>
      </header>
      <FortuneProfileList profiles={profiles} />
    </main>
  );
}
