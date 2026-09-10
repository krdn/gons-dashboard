"use client";
import { useState, useTransition } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { updateMemoAction } from "@/features/memo-manage/client";
export function DocumentEditor({
  id,
  title,
  content,
}: {
  id: string;
  title: string;
  content: string;
}) {
  const [open, setOpen] = useState(false);
  const [nextTitle, setNextTitle] = useState(title);
  const [nextContent, setNextContent] = useState(content);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const dirty = nextTitle !== title || nextContent !== content;
  const valid =
    nextTitle.trim().length > 0 &&
    nextContent.trim().length > 0 &&
    nextContent.length <= 20_000;
  function close(value: boolean) {
    if (pending) return;
    if (
      !value &&
      dirty &&
      !window.confirm("저장하지 않은 수정이 있습니다. 닫으시겠습니까?")
    )
      return;
    setOpen(value);
    setNextTitle(title);
    setNextContent(content);
    setError("");
  }
  function save() {
    startTransition(async () => {
      try {
        const result = await updateMemoAction(id, {
          title: nextTitle,
          cleanedContent: nextContent,
          expected: { title, cleanedContent: content },
        });
        if (result.kind === "ok") setOpen(false);
        else
          setError(
            result.kind === "conflict"
              ? "다른 곳에서 문서가 수정되었습니다. 현재 입력을 복사해 두고 창을 닫은 뒤 페이지를 새로고침하세요."
              : result.kind === "not-found"
                ? "문서를 찾을 수 없습니다. 보관함에서 다시 확인하세요."
                : "수정하지 못했습니다. 내용을 유지했으니 다시 시도하세요.",
          );
      } catch {
        setError(
          "연결 또는 로그인 상태를 확인하세요. 작성한 내용은 유지됩니다.",
        );
      }
    });
  }
  return (
    <Dialog.Root open={open} onOpenChange={close}>
      <Dialog.Trigger className="hub-button">문서 수정</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="hub-dialog-overlay" />
        <Dialog.Content
          className="hub-command-dialog"
          onEscapeKeyDown={(event) => {
            if (pending) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (pending) event.preventDefault();
          }}
        >
          <Dialog.Title className="text-lg font-semibold">
            문서 수정
          </Dialog.Title>
          <Dialog.Description className="text-text-muted mb-5 mt-2 text-sm">
            이 문서에 변경 내용을 저장합니다. 처음 작성한 원문은 메모에
            보존됩니다.
          </Dialog.Description>
          <fieldset disabled={pending} className="space-y-4">
            <label className="hub-field">
              제목
              <input
                value={nextTitle}
                maxLength={160}
                onChange={(e) => setNextTitle(e.target.value)}
              />
            </label>
            <label className="hub-field">
              본문 (Markdown)
              <textarea
                rows={15}
                value={nextContent}
                maxLength={20_000}
                onChange={(e) => setNextContent(e.target.value)}
              />
            </label>
          </fieldset>
          <p role="alert" className="text-warn mt-3 text-sm">
            {error}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              className="hub-button"
              disabled={pending}
              onClick={() => close(false)}
            >
              취소
            </button>
            <button
              className="hub-button primary"
              disabled={!valid || !dirty || pending}
              onClick={save}
            >
              {pending ? "저장 중…" : "변경 저장"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
