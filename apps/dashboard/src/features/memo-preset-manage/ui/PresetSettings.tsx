"use client";
import { useState } from "react";
import type { PresetCatalogEntry } from "@/features/memo-transform/client";
import {
  type MemoModelCatalog,
  type MemoModelCatalogSnapshot,
  type MemoModelSelection,
} from "@/entities/memo/client";
import { saveDefaultMemoModelAction } from "../client";
import { PresetEditor } from "./PresetEditor";
import { ModelSelectionFields } from "./ModelSelectionFields";

interface PresetSettingsProps {
  catalog: PresetCatalogEntry[];
  initialDefaultModel: MemoModelSelection;
  modelCatalogSnapshot: MemoModelCatalogSnapshot;
}

/** null = "+ 새 프리셋" 선택 상태, undefined = 아직 아무것도 선택 안 함(모바일 목록 표시). */
type Selection = PresetCatalogEntry | null | undefined;

function badgeFor(entry: PresetCatalogEntry): {
  text: string;
  className: string;
} {
  if (!entry.isBuiltin) return { text: "커스텀", className: "text-blue-600" };
  if (entry.isOverridden)
    return { text: "수정됨", className: "text-amber-600" };
  return { text: "기본", className: "text-neutral-400" };
}

function PresetListItem({
  entry,
  selected,
  defaultModel,
  modelCatalog,
  onSelect,
}: {
  entry: PresetCatalogEntry;
  selected: boolean;
  defaultModel: MemoModelSelection;
  modelCatalog: MemoModelCatalog;
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
        (selected
          ? "border-neutral-900 bg-neutral-50"
          : "border-neutral-200 hover:border-neutral-400")
      }
    >
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-neutral-900">
          {entry.label}
        </span>
        <span className={"shrink-0 text-xs " + badge.className}>
          {badge.text}
        </span>
      </span>
      <span className="mt-0.5 block truncate text-xs text-neutral-400">
        {entry.model
          ? (entry.modelId ?? modelCatalog[entry.model][0])
          : defaultModel.modelId}{" "}
        · {entry.instruction.split("\n")[0]}
      </span>
    </button>
  );
}

export function PresetSettings({
  catalog,
  initialDefaultModel,
  modelCatalogSnapshot,
}: PresetSettingsProps) {
  const modelCatalog = modelCatalogSnapshot.catalog;
  const [selectedSlug, setSelectedSlug] = useState<string | null | undefined>(
    undefined,
  );
  const [dirty, setDirty] = useState(false);
  const [defaultModel, setDefaultModel] = useState(initialDefaultModel);
  const [modelSaving, setModelSaving] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);

  const builtins = catalog.filter((e) => e.isBuiltin);
  const customs = catalog.filter((e) => !e.isBuiltin);

  const selection: Selection =
    selectedSlug === undefined
      ? undefined
      : selectedSlug === null
        ? null
        : (catalog.find((e) => e.slug === selectedSlug) ?? null);

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

  async function changeDefaultModel(model: MemoModelSelection | null) {
    if (!model) return;
    const previous = defaultModel;
    setDefaultModel(model);
    setModelSaving(true);
    setModelError(null);
    try {
      const result = await saveDefaultMemoModelAction(model);
      if (result.kind !== "ok") {
        setDefaultModel(previous);
        setModelError("전체 기본 모델 저장에 실패했습니다.");
      }
    } catch {
      setDefaultModel(previous);
      setModelError("전체 기본 모델 저장에 실패했습니다.");
    } finally {
      setModelSaving(false);
    }
  }

  return (
    <div>
      <section className="mb-6 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
        <div className="grid gap-4 md:grid-cols-[minmax(180px,1fr)_minmax(360px,1.5fr)] md:items-end">
          <div>
            <label
              htmlFor="memo-default-provider"
              className="text-sm font-semibold text-neutral-700"
            >
              전체 기본 모델
            </label>
            <p className="mt-0.5 text-xs text-neutral-400">
              별도 모델을 지정하지 않은 모든 프리셋에 적용됩니다.
            </p>
          </div>
          <div>
            <ModelSelectionFields
              idPrefix="memo-default"
              value={defaultModel}
              snapshot={modelCatalogSnapshot}
              disabled={modelSaving}
              onChange={changeDefaultModel}
            />
            {modelSaving && (
              <span className="mt-1 block text-right text-xs text-neutral-400">
                저장 중…
              </span>
            )}
          </div>
        </div>
        {modelError && (
          <p role="alert" className="mt-2 text-xs text-red-600">
            {modelError}
          </p>
        )}
      </section>

      <div className="md:grid md:grid-cols-[280px_1fr] md:gap-6">
        <div className={selection !== undefined ? "hidden md:block" : ""}>
          <div className="space-y-6">
            <section>
              <h2 className="mb-2 text-sm font-semibold text-neutral-500">
                기본 프리셋
              </h2>
              <div className="space-y-1.5">
                {builtins.map((entry) => (
                  <PresetListItem
                    key={entry.slug}
                    entry={entry}
                    selected={selection?.slug === entry.slug}
                    defaultModel={defaultModel}
                    modelCatalog={modelCatalog}
                    onSelect={() => selectEntry(entry)}
                  />
                ))}
              </div>
            </section>

            <section>
              <h2 className="mb-2 text-sm font-semibold text-neutral-500">
                내 프리셋
              </h2>
              <div className="space-y-1.5">
                {customs.map((entry) => (
                  <PresetListItem
                    key={entry.slug}
                    entry={entry}
                    selected={selection?.slug === entry.slug}
                    defaultModel={defaultModel}
                    modelCatalog={modelCatalog}
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
                defaultModel={defaultModel}
                modelCatalogSnapshot={modelCatalogSnapshot}
                onDone={handleDone}
                onDirtyChange={setDirty}
              />
            </>
          ) : (
            <p className="text-sm text-neutral-400">
              왼쪽에서 프리셋을 선택하세요.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
