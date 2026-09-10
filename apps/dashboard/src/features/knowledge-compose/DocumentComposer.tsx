"use client";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import Link from "next/link";
import { MarkdownBody } from "@/shared/ui/MarkdownBody";
import {
  buildDocument,
  createDocumentRequestId,
  DOCUMENT_TEMPLATES,
  type DocumentTemplate,
} from "./templates";
import {
  parseDocumentDraft,
  readDocumentDraft,
  subscribeToDraft,
  type DocumentDraft,
} from "./draft";
import { saveDocumentAction } from "./saveDocumentAction";

export function DocumentComposer({
  initialTemplate,
  initialProject = "",
  userId = "preview",
}: {
  initialTemplate: DocumentTemplate;
  initialProject?: string;
  userId?: string;
}) {
  const saveRequest = useRef<string | null>(null);
  const storageKey = `gons:document:${userId}:${initialTemplate}:${initialProject}`;
  const stored = useSyncExternalStore(
    subscribeToDraft,
    () => readDocumentDraft(storageKey),
    () => null,
  );
  const [memoryDraft, setMemoryDraft] = useState<DocumentDraft | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const draft = memoryDraft ??
    parseDocumentDraft(stored) ?? {
      kind: initialTemplate,
      project: initialProject,
      title: "",
      drafts: {},
      requestId: null,
    };
  const { kind, project, title, drafts } = draft;
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const values = drafts[kind] ?? [];
  const dirty = Boolean(
    title ||
    Object.values(drafts).some((items) => items?.some((item) => item.trim())),
  );
  function persist(next: DocumentDraft) {
    setMemoryDraft(next);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next));
      window.dispatchEvent(new Event("gons-document-draft"));
      setStorageFailed(false);
    } catch {
      setStorageFailed(true);
    }
  }
  function change(patch: Partial<DocumentDraft>) {
    saveRequest.current = null;
    persist({ ...draft, ...patch, requestId: null });
    setSaved(null);
    setConflict(null);
    setNotice("");
  }
  function clearStored(requestId: string) {
    try {
      if (
        parseDocumentDraft(readDocumentDraft(storageKey))?.requestId !==
        requestId
      )
        return;
      sessionStorage.removeItem(storageKey);
      window.dispatchEvent(new Event("gons-document-draft"));
    } catch {
      /* 현재 입력은 메모리에 유지된다. */
    }
  }
  useEffect(() => {
    if (!dirty || saved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    // History 이동은 sessionStorage에서 복원한다. 저장소가 차단된 환경만 링크 이탈도 경고한다.
    function guardNavigation(event: MouseEvent) {
      if (!storageFailed) return;
      const link = (event.target as HTMLElement).closest?.("a[href]");
      if (
        !(link instanceof HTMLAnchorElement) ||
        link.target === "_blank" ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.button !== 0 ||
        link.hasAttribute("download")
      )
        return;
      const target = new URL(link.href);
      if (
        target.pathname === window.location.pathname &&
        target.search === window.location.search
      )
        return;
      if (
        !window.confirm(
          "초안을 임시 보관할 수 없습니다. 저장하지 않고 나가시겠습니까?",
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", guardNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", guardNavigation, true);
    };
  }, [dirty, saved, storageFailed]);
  const template = DOCUMENT_TEMPLATES[kind];
  const content = buildDocument(kind, project, title || template.label, values);
  const valid =
    title.trim().length > 0 &&
    values.some((value) => value?.trim()) &&
    content.length <= 20_000;
  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setNotice("Markdown을 복사했습니다. 전달할 AI에 붙여넣으세요.");
    } catch {
      setNotice("클립보드에 접근할 수 없습니다. Markdown 파일로 내려받으세요.");
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/markdown;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(title || template.label).replace(/[^\p{L}\p{N}_-]/gu, "_").slice(0, 80)}.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("Markdown 파일을 내려받았습니다.");
  }
  function save() {
    const requestId =
      saveRequest.current ?? draft.requestId ?? createDocumentRequestId();
    saveRequest.current = requestId;
    persist({ ...draft, requestId });
    startTransition(async () => {
      try {
        const result = await saveDocumentAction({
          requestId,
          kind,
          title: `[${template.label}] ${title.trim()}`,
          content,
        });
        if (result.kind === "ok") {
          setSaved(result.id);
          clearStored(requestId);
          setNotice(
            "지식 보관함에 저장했습니다. 저장한 문서를 열어 바로 수정할 수 있습니다.",
          );
        } else if (result.kind === "conflict") {
          setConflict(result.id);
          setNotice(
            "같은 요청으로 저장된 문서가 이후에 수정되었습니다. 저장된 문서를 확인하세요. 현재 초안은 유지됩니다.",
          );
        } else
          setNotice(
            result.kind === "unauthorized"
              ? "로그인이 만료되었습니다. 먼저 Markdown을 내려받은 뒤 다시 로그인하세요."
              : "저장하지 못했습니다. 입력을 유지했으니 다시 시도하세요.",
          );
      } catch {
        setNotice("연결에 실패했습니다. 입력을 유지했으니 다시 시도하세요.");
      }
    });
  }
  return (
    <div className="space-y-6">
      <div className="hub-template-grid" aria-label="문서 유형">
        {Object.entries(DOCUMENT_TEMPLATES).map(([key, item], index) => (
          <button
            key={key}
            type="button"
            disabled={pending || Boolean(saved) || Boolean(conflict)}
            aria-pressed={kind === key}
            className={`hub-template ${kind === key ? "is-selected" : ""}`}
            onClick={() => change({ kind: key as DocumentTemplate })}
          >
            <span className="hub-eyebrow">0{index + 1}</span>
            <strong>{item.label}</strong>
            <span>{item.description}</span>
          </button>
        ))}
      </div>
      {saved && (
        <div className="hub-inline-guide">
          <strong>문서를 저장했습니다.</strong>
          <span>수정은 저장한 문서에서 이어가세요.</span>
          <button
            type="button"
            onClick={() => change({ title: "", drafts: {} })}
          >
            새 문서 작성 +
          </button>
        </div>
      )}
      {conflict && (
        <div className="hub-notice">
          <Link href={`/knowledge/${conflict}`}>기존에 저장된 문서 열기 →</Link>
          <button className="hub-button ml-3" onClick={() => change({})}>
            별도 새 문서로 계속 작성
          </button>
        </div>
      )}
      <p className="text-text-muted text-xs">
        {storageFailed
          ? "이 브라우저에서는 초안을 임시 보관할 수 없습니다. 이동 전에 저장하거나 내려받으세요."
          : "초안은 현재 탭에 임시 보관되어 뒤로가기 후에도 복원됩니다. 탭을 닫기 전에는 보관함에 저장하세요."}
      </p>
      <div className="hub-composer-grid">
        <section
          className="hub-panel p-5 md:p-7"
          aria-labelledby="compose-heading"
        >
          <div className="hub-section-heading">
            <h2 id="compose-heading">맥락 작성</h2>
            <span className="hub-badge">
              {saved ? "저장됨" : "저장 전 초안"}
            </span>
          </div>
          <fieldset
            disabled={pending || Boolean(saved) || Boolean(conflict)}
            className="space-y-5"
          >
            <label className="hub-field">
              문서 제목{" "}
              <input
                maxLength={120}
                value={title}
                onChange={(e) => change({ title: e.target.value })}
                placeholder="예: 배포 장애를 해결하고 다음 작업 이어가기"
                required
              />
            </label>
            <label className="hub-field">
              프로젝트{" "}
              <input
                maxLength={160}
                value={project}
                onChange={(e) => change({ project: e.target.value })}
                placeholder="프로젝트 이름 또는 공통"
              />
            </label>
            {template.sections.map((section, index) => (
              <label className="hub-field" key={`${kind}-${section}`}>
                {section}
                <textarea
                  rows={3}
                  maxLength={4000}
                  value={values[index] ?? ""}
                  onChange={(e) => {
                    const next = template.sections.map(
                      (_, i) => values[i] ?? "",
                    );
                    next[index] = e.target.value;
                    change({ drafts: { ...drafts, [kind]: next } });
                  }}
                  placeholder={
                    section.includes("검증")
                      ? "실행한 확인과 결과, 아직 확인하지 않은 내용을 구분하세요."
                      : "확인한 사실을 적으세요. 모르는 내용은 비워 두어도 됩니다."
                  }
                />
              </label>
            ))}
          </fieldset>
        </section>
        <aside
          className="hub-preview hub-panel p-5 md:p-7"
          aria-label="문서 미리보기"
        >
          <div className="hub-section-heading">
            <h2>전달할 문서</h2>
            <span className="hub-eyebrow">MARKDOWN</span>
          </div>
          <p className="text-text-muted mb-5 text-sm">
            작성한 내용으로 문서를 구성합니다. 인계 대상 AI에는 자동 전달하지
            않습니다. 저장한 문서는 기존 메모의 자동 AI 액션 추출·다이제스트
            대상에 포함됩니다.
          </p>
          <div className="hub-preview-content">
            <MarkdownBody>{content}</MarkdownBody>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              className="hub-button primary"
              disabled={
                !valid || pending || Boolean(saved) || Boolean(conflict)
              }
              onClick={save}
            >
              {pending ? "저장 중…" : saved ? "저장 완료" : "보관함에 저장"}
            </button>
            <button className="hub-button" onClick={copy}>
              복사
            </button>
            <button className="hub-button" onClick={download}>
              .md 다운로드
            </button>
          </div>
          <p
            className={`mt-3 text-xs tabular-nums ${content.length > 20_000 ? "text-warn" : "text-text-muted"}`}
            role="status"
          >
            {content.length.toLocaleString("ko-KR")} / 20,000자
            {content.length > 20_000
              ? " · 저장 한도를 초과했습니다. 내용을 줄이거나 파일로 내려받으세요."
              : ""}
          </p>
          {!valid && (
            <p className="text-text-muted mt-3 text-xs">
              저장하려면 제목과 한 개 이상의 항목을 작성하세요. 최대 20,000자.
            </p>
          )}
          <p role="status" className="text-accent mt-3 text-sm">
            {notice}
          </p>
          {saved && (
            <Link
              className="hub-text-link mt-3 inline-block"
              href={`/knowledge/${saved}`}
            >
              저장한 문서 열기 →
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}
