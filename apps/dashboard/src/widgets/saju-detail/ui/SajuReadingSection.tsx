import ReactMarkdown from "react-markdown";
import {
  READING_SECTIONS,
  READING_SECTION_LABEL,
  type ReadingSection,
} from "@/entities/saju-chart";

export interface SajuReadingSectionsProps {
  readings: Record<ReadingSection, string | null>;
  errors: Array<{ section: ReadingSection; message: string }>;
}

export function SajuReadingSections({ readings, errors }: SajuReadingSectionsProps) {
  const errorBySection = Object.fromEntries(errors.map((e) => [e.section, e.message]));

  return (
    <div className="flex flex-col gap-6">
      {READING_SECTIONS.map((section) => {
        const body = readings[section];
        const err = errorBySection[section];
        return (
          <section
            key={section}
            aria-labelledby={`reading-${section}`}
            className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5"
          >
            <h3
              id={`reading-${section}`}
              className="mb-3 text-sm font-semibold text-[var(--color-text-muted)]"
            >
              {READING_SECTION_LABEL[section]}
            </h3>
            {body ? (
              <div className="text-sm leading-relaxed text-[var(--color-text)] [&_p+p]:mt-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_strong]:font-semibold">
                <ReactMarkdown>{body}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-[var(--color-severity-high)]">
                해설 생성 실패{err ? ` — ${err}` : ""}. 새로고침으로 재시도.
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
