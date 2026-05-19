// 단일 narrative 섹션 (personality / career / relationship / health / daeunSummary).
// RSC 호환. 부모가 5번 호출.
interface Props {
  title: string;
  body: string;
}

export function NarrativeSection({ title, body }: Props) {
  return (
    <section className="py-3">
      <h4
        aria-level={4}
        className="mb-2 text-sm font-semibold text-[var(--color-text)]"
      >
        {title}
      </h4>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text)]">
        {body}
      </p>
    </section>
  );
}
