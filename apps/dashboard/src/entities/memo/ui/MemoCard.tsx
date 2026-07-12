"use client";
import { useState } from "react";
import { Highlighted } from "@/shared/ui/Highlighted";
import type { Memo, MemoTransformation, TransformPresetId } from "../model/types";
import { TRANSFORM_PRESET_IDS, TRANSFORM_PRESET_LABELS } from "../model/types";

interface MemoCardProps {
  memo: Memo;
  /** 이 메모의 저장된 변환본들 — 칩으로 전환 표시. */
  transformations?: MemoTransformation[];
  onEdit?: (memo: Memo) => void;
  onDelete?: (id: string) => void;
  /** AI 정리 다이얼로그 트리거 (조립은 MemoList 담당 — entity는 features 접근 불가). */
  onTransform?: (memo: Memo) => void;
  /** 검색어 하이라이트 — 제목과 현재 보이는 본문 뷰(칩 전환 포함)에 적용. */
  highlightTerms?: string[];
}

// 표시 뷰: 정리본 | 원문 | 저장된 변환본(프리셋 slug — 빌트인·커스텀 공통).
type MemoView = { kind: "cleaned" } | { kind: "raw" } | { kind: "preset"; slug: string };

// locale-free 시각 포맷 (hydration mismatch 방지 — Gotcha #3).
function formatTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function chipLabel(t: MemoTransformation): string {
  return t.presetLabel ?? TRANSFORM_PRESET_LABELS[t.preset as TransformPresetId] ?? t.preset;
}

const BUILTIN = TRANSFORM_PRESET_IDS as readonly string[];

function containsAnyTerm(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase();
  return terms.some((t) => lower.includes(t.toLowerCase()));
}

// 검색 일치가 정리본에 없으면(원문·변환본에서만 일치) 그 뷰를 초기 선택 —
// 하이라이트 없는 카드가 "무관한 결과"처럼 보이는 문제 방지.
function deriveInitialView(
  memo: Memo,
  transformations: MemoTransformation[],
  terms: string[],
): MemoView {
  if (terms.length === 0) return { kind: "cleaned" };
  if (containsAnyTerm(memo.title, terms) || containsAnyTerm(memo.cleanedContent, terms)) {
    return { kind: "cleaned" };
  }
  if (memo.source === "voice" && containsAnyTerm(memo.rawContent, terms)) {
    return { kind: "raw" };
  }
  const matched = transformations.find((t) => containsAnyTerm(t.content, terms));
  return matched ? { kind: "preset", slug: matched.preset } : { kind: "cleaned" };
}

export function MemoCard({
  memo,
  transformations = [],
  onEdit,
  onDelete,
  onTransform,
  highlightTerms = [],
}: MemoCardProps) {
  // 파생 초기 뷰 + 사용자 오버라이드 — 칩 클릭 전까지는 검색어가 실제 일치한 뷰를 보여준다.
  const [userView, setUserView] = useState<MemoView | null>(null);
  const view = userView ?? deriveInitialView(memo, transformations, highlightTerms);
  const setView = setUserView;
  const isVoice = memo.source === "voice";

  const body =
    view.kind === "cleaned"
      ? memo.cleanedContent
      : view.kind === "raw"
        ? memo.rawContent
        : (transformations.find((t) => t.preset === view.slug)?.content ?? memo.cleanedContent);

  // DB 조회는 순서를 보장하지 않으므로(ORDER BY 없음) 칩은 빌트인 고정 순서 → 커스텀(라벨 사전순)으로 정렬 —
  // 재생성·재방문해도 같은 프리셋이 항상 같은 위치에 온다.
  const sortedTransformations = [...transformations].sort((a, b) => {
    const ai = BUILTIN.indexOf(a.preset);
    const bi = BUILTIN.indexOf(b.preset);
    const ar = ai === -1 ? BUILTIN.length : ai;
    const br = bi === -1 ? BUILTIN.length : bi;
    if (ar !== br) return ar - br;
    return chipLabel(a).localeCompare(chipLabel(b), "ko");
  });
  const chips: Array<{ id: string; view: MemoView; label: string }> = [
    { id: "cleaned", view: { kind: "cleaned" }, label: "정리본" },
    ...(isVoice ? [{ id: "raw", view: { kind: "raw" } as MemoView, label: "원문" }] : []),
    ...sortedTransformations.map((t) => ({
      id: `preset:${t.preset}`,
      view: { kind: "preset", slug: t.preset } as MemoView,
      label: chipLabel(t),
    })),
  ];

  function isActive(v: MemoView): boolean {
    if (v.kind !== view.kind) return false;
    return v.kind === "preset" && view.kind === "preset" ? v.slug === view.slug : true;
  }

  return (
    <article className="rounded-lg border border-neutral-200 p-4">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-medium text-neutral-900">
          <Highlighted text={memo.title} terms={highlightTerms} />
        </h3>
        <span className="shrink-0 rounded px-1.5 py-0.5 text-xs text-neutral-500">
          {isVoice ? "🎙 음성" : "✍ 텍스트"}
        </span>
      </header>
      {chips.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={isActive(c.view)}
              onClick={() => setView(c.view)}
              className={
                isActive(c.view)
                  ? "rounded-full bg-neutral-900 px-2.5 py-0.5 text-xs text-white"
                  : "rounded-full border border-neutral-200 px-2.5 py-0.5 text-xs text-neutral-500 hover:text-neutral-900"
              }
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      <p className="whitespace-pre-wrap text-sm text-neutral-700">
        <Highlighted text={body} terms={highlightTerms} />
      </p>
      <footer className="mt-3 flex items-center gap-3 text-xs text-neutral-400">
        <time>{formatTime(memo.createdAt)}</time>
        {onTransform && (
          <button type="button" onClick={() => onTransform(memo)} className="hover:text-neutral-700">
            AI 정리
          </button>
        )}
        {onEdit && (
          <button type="button" onClick={() => onEdit(memo)} className="hover:text-neutral-700">
            편집
          </button>
        )}
        {onDelete && (
          <button type="button" onClick={() => onDelete(memo.id)} className="hover:text-red-600">
            삭제
          </button>
        )}
      </footer>
    </article>
  );
}
