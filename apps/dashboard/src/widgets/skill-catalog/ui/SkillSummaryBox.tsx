// 스킬 본문 위에 표시되는 한글 "한눈에" 요약 박스.
// 본문(영어 원문)과 분리된 전용 컴포넌트라 본문의 native blockquote 와 충돌하지 않는다.
// 순수 프레젠테이션 — summaryKo 없으면 null (번역 없는 스킬은 박스 생략, graceful).

export function SkillSummaryBox({ summaryKo }: { summaryKo: string | null }) {
  if (!summaryKo) return null;
  const lines = summaryKo.split("\n");
  return (
    <aside className="mb-4 rounded-md border-l-2 border-[var(--color-accent)] bg-[var(--color-surface-2)] px-4 py-3">
      <p className="mb-1 text-xs font-semibold tracking-tight text-[var(--color-text)]">
        📌 한눈에
      </p>
      <div className="space-y-0.5 text-sm leading-relaxed text-[var(--color-text)]">
        {lines.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
    </aside>
  );
}
