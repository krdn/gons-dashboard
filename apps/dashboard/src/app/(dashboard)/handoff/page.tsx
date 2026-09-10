import { redirect } from "next/navigation";
import { auth } from "@/shared/lib/auth";
import { DocumentComposer } from "@/features/knowledge-compose/DocumentComposer";
import { isDocumentTemplate } from "@/features/knowledge-compose/templates";
export const dynamic = "force-dynamic";
export default async function HandoffPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string; project?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const params = await searchParams;
  const template =
    params.template && isDocumentTemplate(params.template)
      ? params.template
      : "handoff";
  return (
    <main className="hub-page">
      <header className="hub-page-heading">
        <div>
          <span className="hub-eyebrow">CONTEXT STUDIO</span>
          <h1>지식을 다음 작업으로.</h1>
          <p>AI 인계, 기술 매뉴얼, 학습 기록을 작성하고 재사용하세요.</p>
        </div>
        <span className="hub-badge">직접 작성 · Markdown 전달</span>
      </header>
      <DocumentComposer
        key={`${template}:${params.project ?? ""}`}
        userId={session.user.id}
        initialTemplate={template}
        initialProject={(params.project ?? "").slice(0, 160)}
      />
    </main>
  );
}
