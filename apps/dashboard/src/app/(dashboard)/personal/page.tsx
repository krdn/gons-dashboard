import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import { WIDGET_REGISTRY } from "@/app/_widgets/registry";
import { renderEntry } from "@/app/_widgets/renderEntry";
import { PushSubscribeButton } from "@/widgets/email-digest";
export const dynamic = "force-dynamic";
export default async function PersonalPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return (
    <main className="hub-page">
      <header className="hub-page-heading">
        <div>
          <span className="hub-eyebrow">PERSONAL SPACE</span>
          <h1>나의 하루</h1>
          <p>이메일, 일정, 투자와 생활을 한곳에서 챙기세요.</p>
        </div>
        <Link className="hub-button" href="/">
          워크스페이스 →
        </Link>
      </header>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">
        <div className="space-y-6">
          {WIDGET_REGISTRY.filter((w) =>
            ["email-digest", "important-emails", "stock-analysis"].includes(
              w.id,
            ),
          ).map(renderEntry)}
        </div>
        <aside className="space-y-6">
          {WIDGET_REGISTRY.filter((w) =>
            [
              "calendar",
              "fortune",
              "supplement-checker",
              "memo-digest",
            ].includes(w.id),
          ).map(renderEntry)}
        </aside>
      </div>
      <footer className="mt-8 flex gap-5">
        <PushSubscribeButton />
        <a
          className="hub-text-link"
          href="https://mail.google.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          Gmail 열기 ↗
        </a>
      </footer>
    </main>
  );
}
