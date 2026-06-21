import type { LookupResult, InteractionEntry } from "@krdn/gons-health";
import { ABSTAIN_MESSAGE } from "@krdn/gons-health";
import { SEVERITY_META, ACTION_LABEL, EVIDENCE_LABEL } from "../lib/severityStyles";

// cite-or-abstain 계약의 UI 명세는 gons-health 의 원본 ResultCard 를 따른다.
// hit → 반드시 인용(PMID·db·url·quote·확인일)과 근거강도를 노출한다.
//        (CLAUDE.md: "약사가 보는 모든 경고는 검증+인용된 것")
// miss → result.message(ABSTAIN_MESSAGE)를 그대로 렌더. "안전함" 함의 표현 금지.

function EntryCard({ entry }: { entry: InteractionEntry }) {
  const sev = SEVERITY_META[entry.severity];
  return (
    <div className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold" style={{ color: sev.token }}>
          {sev.dot} {sev.label}
        </span>
        <span className="rounded bg-[var(--color-surface-2)] px-2 py-0.5 text-[var(--color-text-muted)]">
          {ACTION_LABEL[entry.action_type]}
        </span>
        <span
          className="rounded bg-[var(--color-surface-2)] px-2 py-0.5 text-[var(--color-text-muted)]"
          title="인용 출처를 1차문헌과 대조 완료. 최종 임상 판단은 약사가 합니다."
        >
          ✅ 인용 검증됨 · 근거강도 {EVIDENCE_LABEL[entry.evidence_level]}
        </span>
      </div>

      <p className="mt-2 text-sm font-medium text-[var(--color-text)]">
        {entry.drug_class} <span className="text-[var(--color-text-subtle)]">×</span>{" "}
        {entry.supplement}
      </p>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">{entry.mechanism}</p>
      <p className="mt-1 text-sm font-semibold text-[var(--color-text)]">
        {entry.recommendation}
      </p>

      <p className="mt-2 text-xs text-[var(--color-text-subtle)]">
        근거:{" "}
        <a
          href={entry.source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--color-accent)] hover:underline"
        >
          {entry.source.db} {entry.source.id}
        </a>{" "}
        — &ldquo;{entry.source.quote}&rdquo; (확인일 {entry.source.retrieved_date})
      </p>
    </div>
  );
}

export function SupplementResult({ result }: { result: LookupResult }) {
  // hit 이지만 엔트리가 비면(이론상) abstain 으로 안전하게 폴백.
  const shouldAbstain =
    result.kind === "abstain" || (result.kind === "hit" && result.entries.length === 0);

  if (shouldAbstain) {
    const message = result.kind === "abstain" ? result.message : ABSTAIN_MESSAGE;
    return (
      <div className="rounded-lg border border-dashed border-[var(--color-hairline-strong)] bg-[var(--color-surface)] p-3 text-sm text-[var(--color-text-muted)]">
        {message}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {result.entries.map((e) => (
        <EntryCard key={e.id} entry={e} />
      ))}
    </div>
  );
}
