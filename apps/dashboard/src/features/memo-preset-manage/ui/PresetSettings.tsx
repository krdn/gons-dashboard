"use client";
import { useState } from "react";
import type { PresetCatalogEntry } from "@/features/memo-transform/client";
import { PresetEditor } from "./PresetEditor";

interface PresetSettingsProps {
  catalog: PresetCatalogEntry[];
}

/** null = "+ 새 프리셋" 선택 상태, undefined = 아직 아무것도 선택 안 함(모바일 목록 표시). */
type Selection = PresetCatalogEntry | null | undefined;

function badgeFor(entry: PresetCatalogEntry): { text: string; className: string } {
  if (!entry.isBuiltin) return { text: "커스텀", className: "text-blue-600" };
  if (entry.isOverridden) return { text: "수정됨", className: "text-amber-600" };
  return { text: "기본", className: "text-neutral-400" };
}

function PresetListItem({
  entry,
  selected,
  onSelect,
}: {
  entry: PresetCatalogEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  const badge = badgeFor(entry);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={
        "w-full rounded-lg border px-3 py-2 text-left transition-colors " +
        (selected ? "border-neutral-900 bg-neutral-50" : "border-neutral-200 hover:border-neutral-400")
      }
    >
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-neutral-900">{entry.label}</span>
        <span className={"shrink-0 text-xs " + badge.className}>{badge.text}</span>
      </span>
      <span className="mt-0.5 block truncate text-xs text-neutral-400">
        {entry.instruction.split("\n")[0]}
      </span>
    </button>
  );
}

export function PresetSettings({ catalog }: PresetSettingsProps) {
  const [selectedSlug, setSelectedSlug] = useState<string | null | undefined>(undefined);
  const [dirty, setDirty] = useState(false);

  const builtins = catalog.filter((e) => e.isBuiltin);
  const customs = catalog.filter((e) => !e.isBuiltin);

  const selection: Selection =
    selectedSlug === undefined ? undefined : selectedSlug === null ? null : (catalog.find((e) => e.slug === selectedSlug) ?? null);

  function confirmLeaveIfDirty(): boolean {
    if (!dirty) return true;
    return window.confirm("저장하지 않은 변경이 있습니다. 이동할까요?");
  }

  function selectEntry(entry: PresetCatalogEntry) {
    if (!confirmLeaveIfDirty()) return;
    setDirty(false);
    setSelectedSlug(entry.slug);
  }

  function selectNew() {
    if (!confirmLeaveIfDirty()) return;
    setDirty(false);
    setSelectedSlug(null);
  }

  function backToList() {
    if (!confirmLeaveIfDirty()) return;
    setDirty(false);
    setSelectedSlug(undefined);
  }

  function handleDone() {
    setDirty(false);
    setSelectedSlug(undefined);
  }

  return (
    <div className="md:grid md:grid-cols-[280px_1fr] md:gap-6">
      <div className={selection !== undefined ? "hidden md:block" : ""}>
        <div className="space-y-6">
          <section>
            <h2 className="mb-2 text-sm font-semibold text-neutral-500">기본 프리셋</h2>
            <div className="space-y-1.5">
              {builtins.map((entry) => (
                <PresetListItem
                  key={entry.slug}
                  entry={entry}
                  selected={selection?.slug === entry.slug}
                  onSelect={() => selectEntry(entry)}
                />
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-neutral-500">내 프리셋</h2>
            <div className="space-y-1.5">
              {customs.map((entry) => (
                <PresetListItem
                  key={entry.slug}
                  entry={entry}
                  selected={selection?.slug === entry.slug}
                  onSelect={() => selectEntry(entry)}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={selectNew}
              className="mt-2 w-full rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500 hover:border-neutral-400 hover:text-neutral-900"
            >
              + 새 프리셋
            </button>
          </section>
        </div>
      </div>

      <div className={selection === undefined ? "hidden md:block" : ""}>
        {selection !== undefined ? (
          <>
            <button
              type="button"
              onClick={backToList}
              className="mb-3 text-sm text-neutral-500 hover:text-neutral-900 md:hidden"
            >
              ← 목록
            </button>
            <PresetEditor
              key={selection?.slug ?? "new"}
              entry={selection}
              onDone={handleDone}
              onDirtyChange={setDirty}
            />
          </>
        ) : (
          <p className="text-sm text-neutral-400">왼쪽에서 프리셋을 선택하세요.</p>
        )}
      </div>
    </div>
  );
}
