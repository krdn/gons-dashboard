import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import { getMemo } from "@/entities/memo/server";
import { MarkdownBody } from "@/shared/ui/MarkdownBody";
import { DocumentEditor } from "@/features/knowledge-compose/DocumentEditor";
import { DocumentExport } from "@/features/knowledge-compose/DocumentExport";
export const dynamic = "force-dynamic";
export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    notFound();
  const memo = await getMemo(session.user.id, id);
  if (!memo) notFound();
  return (
    <main className="hub-page max-w-[1040px]">
      <Link className="hub-text-link" href="/knowledge">
        ← 지식 보관함
      </Link>
      <header className="hub-page-heading mt-6">
        <div>
          <span className="hub-eyebrow">SAVED KNOWLEDGE</span>
          <h1 className="break-words">{memo.title}</h1>
          <p>
            수정{" "}
            {new Intl.DateTimeFormat("ko-KR", {
              timeZone: "Asia/Seoul",
              dateStyle: "medium",
              timeStyle: "short",
            }).format(memo.updatedAt)}{" "}
            KST
          </p>
        </div>
        <DocumentEditor
          id={memo.id}
          title={memo.title}
          content={memo.cleanedContent}
        />
      </header>
      <DocumentExport title={memo.title} content={memo.cleanedContent} />
      <article className="hub-panel mt-5 p-6 md:p-10">
        <MarkdownBody>{memo.cleanedContent}</MarkdownBody>
      </article>
    </main>
  );
}
