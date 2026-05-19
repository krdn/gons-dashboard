// 출처 인용 — 명조 narrative 하단 footer.
interface Props {
  citations: string[];
}

export function CitationsFootnote({ citations }: Props) {
  if (citations.length === 0) return null;

  return (
    <footer className="border-t border-[var(--color-hairline)] py-3">
      <div className="mb-1 text-xs text-[var(--color-text-secondary)]">출처</div>
      <ul className="space-y-1">
        {citations.map((c, idx) => (
          <li
            key={`citation-${idx}`}
            className="text-xs text-[var(--color-text-secondary)]"
          >
            · {c}
          </li>
        ))}
      </ul>
    </footer>
  );
}
