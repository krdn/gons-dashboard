// 로그인 페이지 — Google OAuth 진입점.
import { signIn } from "@/shared/lib/auth";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-start justify-center px-6">
      <h1 className="text-h1 font-bold tracking-tight">
        gons<span className="text-[var(--color-accent)]">.</span>dashboard
      </h1>
      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
        Google 계정으로 로그인하세요. 등록된 계정만 접근 가능합니다.
      </p>

      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/" });
        }}
        className="mt-8 w-full"
      >
        <button
          type="submit"
          className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-2)] border border-[var(--color-hairline-strong)] bg-[var(--color-surface)] px-4 py-3 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          Google로 계속하기
        </button>
      </form>
    </main>
  );
}
