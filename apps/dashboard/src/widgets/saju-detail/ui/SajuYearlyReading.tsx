import ReactMarkdown from "react-markdown";

export interface SajuYearlyReadingProps {
  body: string | null;
  error: string | null;
  year: number;
}

export function SajuYearlyReading({ body, error }: SajuYearlyReadingProps) {
  if (error) {
    return (
      <p className="text-sm text-[var(--color-severity-high)]">
        세운 생성 실패 — {error}. 새로고침으로 재시도.
      </p>
    );
  }
  if (!body) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">세운 풀이를 준비 중입니다…</p>
    );
  }
  return (
    <div className="text-sm leading-relaxed text-[var(--color-text)] [&_p+p]:mt-3 [&_strong]:font-semibold [&_strong]:text-[var(--color-text-muted)]">
      <ReactMarkdown>{body}</ReactMarkdown>
    </div>
  );
}
