"use client";

import { useState } from "react";
import type { PortfolioHolding } from "@/entities/portfolio-holding/client";
import { updateHolding } from "../api/updateHolding";
import { deleteHolding } from "../api/deleteHolding";

interface Props {
  holding: PortfolioHolding;
  onMutate: () => void;
}

type EditField = "quantity" | "avgCost" | "purchasedAt" | null;

export function HoldingRow({ holding, onMutate }: Props) {
  const [edit, setEdit] = useState<EditField>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = (field: EditField, current: string) => {
    setEdit(field);
    setDraft(current);
    setError(null);
  };

  const cancelEdit = () => {
    setEdit(null);
    setDraft("");
  };

  const save = async () => {
    if (edit === null) return;
    setBusy(true);
    setError(null);
    const input: Parameters<typeof updateHolding>[0] = { id: holding.id };
    if (edit === "quantity") input.quantity = draft;
    if (edit === "avgCost") input.avgCost = draft;
    if (edit === "purchasedAt") input.purchasedAt = draft.length === 0 ? null : draft;
    const res = await updateHolding(input);
    setBusy(false);
    if (!res.success) {
      setError(res.error ?? "수정 실패");
      return;
    }
    cancelEdit();
    onMutate();
  };

  const onDelete = async () => {
    if (!confirm(`${holding.displayName} 삭제할까요?`)) return;
    setBusy(true);
    const res = await deleteHolding({ id: holding.id });
    setBusy(false);
    if (!res.success) {
      setError(res.error ?? "삭제 실패");
      return;
    }
    onMutate();
  };

  // Cell 은 컴포넌트가 아닌 일반 render 함수 — react-hooks/static-components 룰 회피.
  // (nested 컴포넌트는 매 render 마다 새 component identity 가 만들어져 state reset)
  const renderCell = (field: Exclude<EditField, null>, display: string) => {
    if (edit === field) {
      return (
        <input
          type={field === "purchasedAt" ? "date" : "text"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") cancelEdit();
          }}
          autoFocus
          disabled={busy}
          className="w-full rounded border border-[var(--color-accent)] bg-[var(--color-surface)] px-2 py-1 text-sm focus:outline-none"
        />
      );
    }
    return (
      <button
        type="button"
        onClick={() => startEdit(field, display === "—" ? "" : display)}
        className="w-full rounded px-2 py-1 text-left text-sm hover:bg-[var(--color-surface-2)]"
      >
        {display}
      </button>
    );
  };

  return (
    <tr className="border-b border-[var(--color-hairline)]">
      <td className="px-3 py-2">
        <div className="font-semibold">{holding.displayName}</div>
        <div className="text-xs text-[var(--color-text-muted)]">
          {holding.symbol} · {holding.market}
        </div>
      </td>
      <td className="px-3 py-2 text-xs uppercase text-[var(--color-text-muted)]">
        {holding.assetClass}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {holding.kind === "watchlist" && holding.quantity == null
          ? <span className="text-[var(--color-text-muted)]">—</span>
          : renderCell("quantity", holding.quantity ?? "")}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {holding.kind === "watchlist" && holding.avgCost == null
          ? <span className="text-[var(--color-text-muted)]">—</span>
          : renderCell("avgCost", holding.avgCost ?? "")}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {renderCell("purchasedAt", holding.purchasedAt ?? "—")}
      </td>
      <td className="px-3 py-2 text-center">
        <button
          type="button"
          onClick={async () => {
            setBusy(true);
            const res = await updateHolding({
              id: holding.id,
              pushOptIn: !holding.pushOptIn,
            });
            setBusy(false);
            if (!res.success) {
              setError(res.error ?? "토글 실패");
              return;
            }
            onMutate();
          }}
          disabled={busy}
          aria-label={holding.pushOptIn ? "푸시 끄기" : "푸시 켜기"}
          className="rounded p-1 text-sm hover:bg-[var(--color-surface-2)] disabled:opacity-50"
        >
          {holding.pushOptIn ? "🔔" : "🔕"}
        </button>
      </td>
      <td className="px-3 py-2 text-right">
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          aria-label="삭제"
          className="rounded p-1 text-[var(--color-text-muted)] hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
        >
          ✕
        </button>
        {error && <div className="mt-1 text-[10px] text-red-600">{error}</div>}
      </td>
    </tr>
  );
}
