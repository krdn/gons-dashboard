import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

// ReactMarkdown 산출 요소에는 클래스를 직접 못 붙이므로 부모 래퍼의 자손 선택자로
// 디자인 토큰 스타일을 내린다. skill/agent 카탈로그 상세와 메모 본문이 공유.
const MARKDOWN_STYLE =
  "text-sm leading-relaxed text-[var(--color-text)] [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--color-hairline)] [&_blockquote]:pl-3 [&_blockquote]:text-[var(--color-text-muted)] [&_code]:rounded [&_code]:bg-[var(--color-surface-2)] [&_code]:px-1 [&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-sm [&_h2]:font-semibold [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p+p]:mt-2 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-[var(--color-surface-2)] [&_pre]:p-3 [&_strong]:font-semibold [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-[var(--color-hairline)] [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-[var(--color-hairline)] [&_th]:bg-[var(--color-surface-2)] [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5";

/** GFM(표·체크리스트 포함) 마크다운 본문 — raw HTML은 렌더하지 않는다(XSS 안전). */
export function MarkdownBody({
  children,
  preserveLineBreaks = false,
}: {
  children: string;
  /** 단일 줄바꿈을 <br>로 렌더 — textarea 입력·LLM 산출 메모용.
      카탈로그 문서(hard-wrap된 SKILL.md 문단)는 표준 collapse가 맞으므로 기본 off. */
  preserveLineBreaks?: boolean;
}) {
  return (
    <div className={MARKDOWN_STYLE}>
      <ReactMarkdown remarkPlugins={preserveLineBreaks ? [remarkGfm, remarkBreaks] : [remarkGfm]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
