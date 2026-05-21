# Phase 4: Portfolio CRUD UI

> 부모: `../2026-05-21-stock-analysis-widget.md`

**범위:** 포트폴리오 종목 등록/수정/삭제 UI + 페르소나 모델 선택 UI + 통합 설정 모달. spec §5.3 의 "Portfolio 탭 + LLM 탭".

**완료 조건:**
- Server Actions: `addHolding`, `updateHolding`, `deleteHolding`, `setPersonaModel`, `resetPersonaModels`
- TickerSearchInput: Yahoo `/api/stock/search` 호출 + 300ms 디바운스
- PortfolioTable: 인라인 편집 (수량/평단/매수일) + 삭제 버튼
- PersonaModelPicker: 6명 (5 페르소나 + 합의자) × 3 모델 라디오
- SettingsModal: Portfolio 탭 + LLM 탭 + 면책 footer
- `pnpm typecheck && pnpm lint && pnpm test` PASS

**전제:**
- Phase 3 PR (#108) 머지 완료 → `feat/stock-analysis-phase-4` cut
- `/api/stock/search` 와 `entities/portfolio-holding/server.ts` (Phase 1-2) 동작
- `persona-router.ts` 의 `updatePersonaOverrides` 사용 (Phase 3 T3.4)
- 모달 라이브러리: Radix UI Dialog 신규 도입

⚠️ **dashboard 의 기존 패턴:**
- Server Actions = `features/<slice>/api/<actionName>.ts` 1액션 1파일
- `"use client"` 컴포넌트가 React 19 패턴 사용
- Modal 컴포넌트 부재 → **Radix Dialog 신규 도입**

---

## Task 4.1: Radix Dialog 도입 + 공통 Modal shell

**Files:**
- Modify: `apps/dashboard/package.json` (`@radix-ui/react-dialog` dependency)
- Create: `apps/dashboard/src/shared/ui/Modal.tsx`

- [ ] **Step 1: 의존성 추가**

Run: `pnpm --filter @gons/dashboard add @radix-ui/react-dialog`
Expected: `apps/dashboard/package.json` dependencies 에 `"@radix-ui/react-dialog": "^1.x.x"` 추가.

- [ ] **Step 2: shared/ui/Modal.tsx 작성**

```tsx
"use client";

// Radix Dialog 기반 공통 Modal shell.
// stock-analysis 의 SettingsModal / StockDetailModal 이 공통으로 사용.
import * as Dialog from "@radix-ui/react-dialog";
import { type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}

const SIZE_CLASS: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
};

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  size = "md",
}: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content
          className={`fixed left-1/2 top-1/2 z-50 w-[92vw] -translate-x-1/2 -translate-y-1/2 ${SIZE_CLASS[size]} max-h-[88vh] overflow-y-auto rounded-xl border border-[var(--color-hairline)] bg-[var(--color-surface)] p-6 shadow-2xl focus:outline-none`}
        >
          <Dialog.Title className="text-xl font-bold tracking-tight">
            {title}
          </Dialog.Title>
          {description && (
            <Dialog.Description className="mt-1 text-sm text-[var(--color-text-muted)]">
              {description}
            </Dialog.Description>
          )}
          <div className="mt-4">{children}</div>
          <Dialog.Close
            aria-label="닫기"
            className="absolute right-4 top-4 rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
          >
            ✕
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 3: typecheck + lint**

Run: `pnpm --filter @gons/dashboard typecheck && cd apps/dashboard && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/package.json apps/dashboard/src/shared/ui/Modal.tsx pnpm-lock.yaml
git commit -m "feat(stock-analysis): shared/ui/Modal (Radix Dialog 기반 공통 모달 shell)"
```

---

## Task 4.2: Server Actions — Portfolio CRUD

**Files:**
- Create: `apps/dashboard/src/features/stock-portfolio-crud/model/schema.ts`
- Create: `apps/dashboard/src/features/stock-portfolio-crud/api/addHolding.ts`
- Create: `apps/dashboard/src/features/stock-portfolio-crud/api/updateHolding.ts`
- Create: `apps/dashboard/src/features/stock-portfolio-crud/api/deleteHolding.ts`

dashboard 의 1액션 1파일 패턴 + NextAuth 세션 + Zod 입력 검증.

- [ ] **Step 1: model/schema.ts**

```ts
import { z } from "zod";

const AssetClassSchema = z.enum(["stock", "crypto", "commodity"]);
const MarketSchema = z.enum(["NASDAQ", "NYSE", "KRX", "CRYPTO", "COMMODITY"]);

const PositiveNumericString = z
  .string()
  .regex(/^\d+(\.\d{1,8})?$/, "양수 (소수점 8자리까지) 형식이어야 합니다");

const NonNegativeNumericString = z
  .string()
  .regex(/^\d+(\.\d{1,8})?$/, "0 이상 (소수점 8자리까지) 형식이어야 합니다");

export const AddHoldingSchema = z.object({
  symbol: z.string().min(1).max(32),
  assetClass: AssetClassSchema,
  market: MarketSchema,
  displayName: z.string().min(1).max(200),
  quantity: PositiveNumericString,
  avgCost: NonNegativeNumericString,
  purchasedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const UpdateHoldingSchema = z.object({
  id: z.string().uuid(),
  quantity: PositiveNumericString.optional(),
  avgCost: NonNegativeNumericString.optional(),
  purchasedAt: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()])
    .optional(),
});

export const DeleteHoldingSchema = z.object({
  id: z.string().uuid(),
});

export type AddHoldingInput = z.infer<typeof AddHoldingSchema>;
export type UpdateHoldingInput = z.infer<typeof UpdateHoldingSchema>;
export type DeleteHoldingInput = z.infer<typeof DeleteHoldingSchema>;
```

- [ ] **Step 2: api/addHolding.ts**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { portfolioHoldings } from "@/shared/lib/db/schema";
import { AddHoldingSchema, type AddHoldingInput } from "../model/schema";

export interface AddHoldingResult {
  success: boolean;
  error?: string;
  holdingId?: string;
}

export async function addHolding(input: AddHoldingInput): Promise<AddHoldingResult> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const parsed = AddHoldingSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "검증 실패" };
  }

  try {
    const [row] = await db
      .insert(portfolioHoldings)
      .values({
        userId: session.user.id,
        symbol: parsed.data.symbol,
        assetClass: parsed.data.assetClass,
        market: parsed.data.market,
        displayName: parsed.data.displayName,
        quantity: parsed.data.quantity,
        avgCost: parsed.data.avgCost,
        purchasedAt: parsed.data.purchasedAt ?? null,
      })
      .returning({ id: portfolioHoldings.id });
    revalidatePath("/");
    return { success: true, holdingId: row.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "DB 에러";
    if (msg.includes("portfolio_holdings_user_symbol_uq")) {
      return { success: false, error: "이미 등록된 종목입니다" };
    }
    return { success: false, error: msg };
  }
}
```

- [ ] **Step 3: api/updateHolding.ts**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { portfolioHoldings } from "@/shared/lib/db/schema";
import { UpdateHoldingSchema, type UpdateHoldingInput } from "../model/schema";

export interface UpdateHoldingResult {
  success: boolean;
  error?: string;
}

export async function updateHolding(input: UpdateHoldingInput): Promise<UpdateHoldingResult> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const parsed = UpdateHoldingSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "검증 실패" };
  }

  const updateValues: Record<string, string | null | Date> = {};
  if (parsed.data.quantity !== undefined) updateValues.quantity = parsed.data.quantity;
  if (parsed.data.avgCost !== undefined) updateValues.avgCost = parsed.data.avgCost;
  if (parsed.data.purchasedAt !== undefined) updateValues.purchasedAt = parsed.data.purchasedAt;
  updateValues.updatedAt = new Date();

  if (Object.keys(updateValues).length === 1) return { success: true }; // updatedAt 만 = 실질 변경 없음

  try {
    const result = await db
      .update(portfolioHoldings)
      .set(updateValues)
      .where(
        and(
          eq(portfolioHoldings.id, parsed.data.id),
          eq(portfolioHoldings.userId, session.user.id),
        ),
      )
      .returning({ id: portfolioHoldings.id });
    if (result.length === 0) return { success: false, error: "종목을 찾을 수 없습니다" };
    revalidatePath("/");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "DB 에러" };
  }
}
```

⚠️ `WHERE id AND userId` — 다른 사용자 row 수정 차단 (Row-Level Security 보조).

- [ ] **Step 4: api/deleteHolding.ts**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { portfolioHoldings } from "@/shared/lib/db/schema";
import { DeleteHoldingSchema, type DeleteHoldingInput } from "../model/schema";

export interface DeleteHoldingResult {
  success: boolean;
  error?: string;
}

export async function deleteHolding(input: DeleteHoldingInput): Promise<DeleteHoldingResult> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const parsed = DeleteHoldingSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "잘못된 ID 형식" };

  try {
    const result = await db
      .delete(portfolioHoldings)
      .where(
        and(
          eq(portfolioHoldings.id, parsed.data.id),
          eq(portfolioHoldings.userId, session.user.id),
        ),
      )
      .returning({ id: portfolioHoldings.id });
    if (result.length === 0) return { success: false, error: "종목을 찾을 수 없습니다" };
    revalidatePath("/");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "DB 에러" };
  }
}
```

- [ ] **Step 5: typecheck + lint**

Run: `pnpm --filter @gons/dashboard typecheck && cd apps/dashboard && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/features/stock-portfolio-crud/
git commit -m "feat(stock-analysis): Server Actions (addHolding/updateHolding/deleteHolding) + Zod 검증"
```

---

## Task 4.3: TickerSearchInput — Yahoo autocomplete

**Files:**
- Create: `apps/dashboard/src/features/stock-portfolio-crud/lib/useDebounce.ts`
- Create: `apps/dashboard/src/features/stock-portfolio-crud/ui/TickerSearchInput.tsx`

- [ ] **Step 1: lib/useDebounce.ts**

```ts
"use client";

import { useEffect, useState } from "react";

export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}
```

- [ ] **Step 2: ui/TickerSearchInput.tsx**

```tsx
"use client";

import { useEffect, useState } from "react";
import type { SearchResult } from "@/entities/stock/client";
import { useDebounce } from "../lib/useDebounce";

interface Props {
  onSelect: (result: SearchResult) => void;
  placeholder?: string;
}

export function TickerSearchInput({
  onSelect,
  placeholder = "종목명 또는 티커 검색 (예: AAPL, 삼성전자)",
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const debouncedQuery = useDebounce(query, 300);

  useEffect(() => {
    let cancelled = false;
    if (debouncedQuery.trim().length === 0) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`/api/stock/search?q=${encodeURIComponent(debouncedQuery)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`검색 실패 (${res.status})`);
        return res.json() as Promise<{ results: SearchResult[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        setResults(data.results);
        setOpen(data.results.length > 0);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setResults([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-2 text-sm focus:border-[var(--color-accent)] focus:outline-none"
      />
      {loading && (
        <div className="absolute right-3 top-2 text-xs text-[var(--color-text-muted)]">
          검색 중…
        </div>
      )}
      {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
      {open && results.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] shadow-lg">
          {results.map((r) => (
            <li
              key={r.symbol}
              onClick={() => {
                onSelect(r);
                setQuery(r.displayName);
                setOpen(false);
              }}
              className="cursor-pointer border-b border-[var(--color-hairline)] px-3 py-2 text-sm last:border-b-0 hover:bg-[var(--color-surface-2)]"
            >
              <div className="flex items-baseline justify-between">
                <strong className="font-semibold">{r.displayName}</strong>
                <span className="text-xs text-[var(--color-text-muted)]">
                  {r.symbol} · {r.exchange}
                </span>
              </div>
              <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
                {r.assetClass} · {r.market}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: typecheck + lint**

Run: `pnpm --filter @gons/dashboard typecheck && cd apps/dashboard && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/features/stock-portfolio-crud/lib/ apps/dashboard/src/features/stock-portfolio-crud/ui/TickerSearchInput.tsx
git commit -m "feat(stock-analysis): TickerSearchInput (Yahoo autocomplete + 300ms 디바운스)"
```

---

## Task 4.4: PortfolioTable — 인라인 편집 + 삭제

**Files:**
- Create: `apps/dashboard/src/features/stock-portfolio-crud/ui/HoldingRow.tsx`
- Create: `apps/dashboard/src/features/stock-portfolio-crud/ui/PortfolioTable.tsx`

- [ ] **Step 1: HoldingRow.tsx**

```tsx
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

  const Cell = ({ field, display }: { field: EditField; display: string }) => {
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
        <Cell field="quantity" display={holding.quantity} />
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        <Cell field="avgCost" display={holding.avgCost} />
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        <Cell field="purchasedAt" display={holding.purchasedAt ?? "—"} />
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
```

- [ ] **Step 2: PortfolioTable.tsx**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PortfolioHolding } from "@/entities/portfolio-holding/client";
import type { SearchResult } from "@/entities/stock/client";
import { TickerSearchInput } from "./TickerSearchInput";
import { HoldingRow } from "./HoldingRow";
import { addHolding } from "../api/addHolding";

interface Props {
  initialHoldings: PortfolioHolding[];
}

export function PortfolioTable({ initialHoldings }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [quantity, setQuantity] = useState("");
  const [avgCost, setAvgCost] = useState("");
  const [purchasedAt, setPurchasedAt] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => router.refresh();

  const onAdd = async () => {
    if (!selected) {
      setAddError("검색에서 종목을 선택해주세요");
      return;
    }
    if (quantity.length === 0 || avgCost.length === 0) {
      setAddError("수량과 평단을 입력해주세요");
      return;
    }
    setBusy(true);
    setAddError(null);
    const res = await addHolding({
      symbol: selected.symbol,
      assetClass: selected.assetClass,
      market: selected.market,
      displayName: selected.displayName,
      quantity,
      avgCost,
      purchasedAt: purchasedAt.length > 0 ? purchasedAt : undefined,
    });
    setBusy(false);
    if (!res.success) {
      setAddError(res.error ?? "추가 실패");
      return;
    }
    setSelected(null);
    setQuantity("");
    setAvgCost("");
    setPurchasedAt("");
    refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[var(--color-hairline)] text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            <th className="px-3 py-2">종목</th>
            <th className="px-3 py-2">자산군</th>
            <th className="px-3 py-2 text-right">수량</th>
            <th className="px-3 py-2 text-right">평단</th>
            <th className="px-3 py-2 text-right">매수일</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {initialHoldings.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-3 py-8 text-center text-sm text-[var(--color-text-muted)]">
                아직 등록된 종목이 없습니다. 아래에서 추가해주세요.
              </td>
            </tr>
          ) : (
            initialHoldings.map((h) => <HoldingRow key={h.id} holding={h} onMutate={refresh} />)
          )}
        </tbody>
      </table>

      <div className="rounded-lg border border-dashed border-[var(--color-hairline)] p-4">
        <div className="mb-2 text-sm font-semibold">+ 종목 추가</div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <TickerSearchInput onSelect={setSelected} />
          <input
            type="text"
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="수량"
            className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-2 text-sm tabular-nums focus:border-[var(--color-accent)] focus:outline-none"
          />
          <input
            type="text"
            inputMode="decimal"
            value={avgCost}
            onChange={(e) => setAvgCost(e.target.value)}
            placeholder="평단"
            className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-2 text-sm tabular-nums focus:border-[var(--color-accent)] focus:outline-none"
          />
          <input
            type="date"
            value={purchasedAt}
            onChange={(e) => setPurchasedAt(e.target.value)}
            className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-2 text-sm focus:border-[var(--color-accent)] focus:outline-none"
          />
          <button
            type="button"
            onClick={onAdd}
            disabled={busy}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "추가 중…" : "추가"}
          </button>
        </div>
        {addError && <div className="mt-2 text-xs text-red-600">{addError}</div>}
      </div>
    </div>
  );
}
```

⚠️ `router.refresh()` + Server Action 의 `revalidatePath("/")` 결합으로 모달 내부 변경이 외부 RSC 까지 fresh 화.

- [ ] **Step 3: typecheck + lint**

Run: `pnpm --filter @gons/dashboard typecheck && cd apps/dashboard && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/features/stock-portfolio-crud/ui/
git commit -m "feat(stock-analysis): PortfolioTable + HoldingRow (인라인 편집 + 추가 폼)"
```

---

## Task 4.5: PersonaModelPicker — 모델 선택 UI

**Files:**
- Create: `apps/dashboard/src/features/stock-persona-config/api/updateOverrides.ts`
- Create: `apps/dashboard/src/features/stock-persona-config/ui/PersonaModelPicker.tsx`

6명 (5 persona + consensus) × 3 모델 라디오. 변경 즉시 Server Action.

- [ ] **Step 1: api/updateOverrides.ts**

```ts
"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { stockPersonaPreferences } from "@/shared/lib/db/schema";
import {
  updatePersonaOverrides,
  type PersonaModelMapping,
} from "@/shared/lib/llm/persona-router";

const ModelNameSchema = z.enum(["claude", "codex", "gemini"]);
const PersonaOrConsensusSchema = z.enum([
  "wallStreet",
  "krExpert",
  "value",
  "growth",
  "technical",
  "consensus",
]);

const UpdateSchema = z.object({
  persona: PersonaOrConsensusSchema,
  model: ModelNameSchema,
});

export interface UpdateOverridesResult {
  success: boolean;
  error?: string;
}

export async function setPersonaModel(input: {
  persona: keyof PersonaModelMapping;
  model: "claude" | "codex" | "gemini";
}): Promise<UpdateOverridesResult> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "잘못된 입력" };

  try {
    await updatePersonaOverrides(session.user.id, {
      [parsed.data.persona]: parsed.data.model,
    } as Partial<PersonaModelMapping>);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "DB 에러" };
  }
}

export async function resetPersonaModels(): Promise<UpdateOverridesResult> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };
  try {
    await db
      .delete(stockPersonaPreferences)
      .where(eq(stockPersonaPreferences.userId, session.user.id));
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "DB 에러" };
  }
}
```

⚠️ `resetPersonaModels` 는 row 자체를 삭제 → 다음 `resolvePersonaModels` 호출 시 DEFAULT_PERSONA_MODELS 가 그대로 적용됨.

- [ ] **Step 2: ui/PersonaModelPicker.tsx**

```tsx
"use client";

import { useState, useTransition } from "react";
import {
  PERSONA_DISPLAY,
  DEFAULT_PERSONA_MODELS,
  type ModelName,
  type PersonaOrConsensus,
} from "@/entities/stock-analysis/client";
import { setPersonaModel, resetPersonaModels } from "../api/updateOverrides";

interface Props {
  initialOverrides: Partial<Record<PersonaOrConsensus, ModelName>>;
}

const PERSONA_ORDER: PersonaOrConsensus[] = [
  "wallStreet",
  "krExpert",
  "value",
  "growth",
  "technical",
  "consensus",
];

const PERSONA_LABEL: Record<PersonaOrConsensus, string> = {
  ...PERSONA_DISPLAY,
  consensus: "합의 요약자",
};

const MODEL_OPTIONS: { value: ModelName; label: string }[] = [
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
  { value: "gemini", label: "Gemini" },
];

export function PersonaModelPicker({ initialOverrides }: Props) {
  const [overrides, setOverrides] = useState(initialOverrides);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const currentModel = (p: PersonaOrConsensus): ModelName =>
    overrides[p] ?? DEFAULT_PERSONA_MODELS[p];

  const onChange = (persona: PersonaOrConsensus, model: ModelName) => {
    setOverrides((prev) => ({ ...prev, [persona]: model }));
    setError(null);
    startTransition(async () => {
      const res = await setPersonaModel({ persona, model });
      if (!res.success) {
        setError(res.error ?? "저장 실패");
        setOverrides((prev) => {
          const next = { ...prev };
          delete next[persona];
          return next;
        });
      }
    });
  };

  const onReset = () => {
    if (!confirm("페르소나 모델 설정을 기본값으로 되돌릴까요?")) return;
    setError(null);
    startTransition(async () => {
      const res = await resetPersonaModels();
      if (!res.success) {
        setError(res.error ?? "리셋 실패");
        return;
      }
      setOverrides({});
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-[var(--color-text-muted)]">
        페르소나마다 분석에 사용할 LLM 모델을 선택하세요. 기본값: Claude×3 (월스트/한국/합의), Codex×2 (가치/기술), Gemini×1 (성장).
      </p>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-hairline)] text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            <th className="px-3 py-2">페르소나</th>
            <th className="px-3 py-2">모델</th>
          </tr>
        </thead>
        <tbody>
          {PERSONA_ORDER.map((p) => (
            <tr key={p} className="border-b border-[var(--color-hairline)]">
              <td className="px-3 py-3 font-semibold">{PERSONA_LABEL[p]}</td>
              <td className="px-3 py-3">
                <div className="flex gap-2" role="radiogroup" aria-label={`${PERSONA_LABEL[p]} 모델 선택`}>
                  {MODEL_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex cursor-pointer items-center gap-1 rounded-lg border px-3 py-1 text-xs ${
                        currentModel(p) === opt.value
                          ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
                          : "border-[var(--color-hairline)] hover:bg-[var(--color-surface-2)]"
                      }`}
                    >
                      <input
                        type="radio"
                        name={`persona-${p}`}
                        value={opt.value}
                        checked={currentModel(p) === opt.value}
                        onChange={() => onChange(p, opt.value)}
                        disabled={pending}
                        className="sr-only"
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && <div className="text-xs text-red-600">{error}</div>}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onReset}
          disabled={pending}
          className="rounded-lg border border-[var(--color-hairline)] px-4 py-2 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
        >
          기본값으로 리셋
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: typecheck + lint**

Run: `pnpm --filter @gons/dashboard typecheck && cd apps/dashboard && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/features/stock-persona-config/
git commit -m "feat(stock-analysis): PersonaModelPicker (6명 × 3 모델 라디오 + optimistic update)"
```

---

## Task 4.6: PortfolioSettingsModal — 통합 컨테이너

**Files:**
- Create: `apps/dashboard/src/widgets/stock-analysis/PortfolioSettingsModal.tsx`
- Create: `apps/dashboard/src/widgets/stock-analysis/SettingsButton.tsx`

- [ ] **Step 1: PortfolioSettingsModal.tsx**

```tsx
"use client";

import { useState } from "react";
import type { PortfolioHolding } from "@/entities/portfolio-holding/client";
import type {
  ModelName,
  PersonaOrConsensus,
} from "@/entities/stock-analysis/client";
import { Modal } from "@/shared/ui/Modal";
import { PortfolioTable } from "@/features/stock-portfolio-crud/ui/PortfolioTable";
import { PersonaModelPicker } from "@/features/stock-persona-config/ui/PersonaModelPicker";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialHoldings: PortfolioHolding[];
  initialOverrides: Partial<Record<PersonaOrConsensus, ModelName>>;
}

type Tab = "portfolio" | "llm";

const TABS: { id: Tab; label: string }[] = [
  { id: "portfolio", label: "포트폴리오" },
  { id: "llm", label: "LLM 모델" },
];

export function PortfolioSettingsModal({
  open,
  onOpenChange,
  initialHoldings,
  initialOverrides,
}: Props) {
  const [tab, setTab] = useState<Tab>("portfolio");

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="포트폴리오 설정"
      description="등록한 종목과 페르소나별 LLM 모델을 관리합니다."
      size="lg"
    >
      <div className="flex flex-col gap-4">
        <div role="tablist" className="flex gap-2 border-b border-[var(--color-hairline)]">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-semibold ${
                tab === t.id
                  ? "border-b-2 border-[var(--color-accent)] text-[var(--color-text)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div>
          {tab === "portfolio" && <PortfolioTable initialHoldings={initialHoldings} />}
          {tab === "llm" && <PersonaModelPicker initialOverrides={initialOverrides} />}
        </div>
        <footer className="border-t border-[var(--color-hairline)] pt-4 text-[10px] text-[var(--color-text-muted)]">
          본 분석은 LLM 페르소나의 가상 의견이며 투자 자문이 아닙니다. 실제 투자 결정은 본인 책임입니다.
        </footer>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: SettingsButton.tsx**

```tsx
"use client";

import { useState } from "react";
import type { PortfolioHolding } from "@/entities/portfolio-holding/client";
import type {
  ModelName,
  PersonaOrConsensus,
} from "@/entities/stock-analysis/client";
import { PortfolioSettingsModal } from "./PortfolioSettingsModal";

interface Props {
  initialHoldings: PortfolioHolding[];
  initialOverrides: Partial<Record<PersonaOrConsensus, ModelName>>;
}

export function SettingsButton({ initialHoldings, initialOverrides }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="포트폴리오 설정"
        className="rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
      >
        ⚙
      </button>
      <PortfolioSettingsModal
        open={open}
        onOpenChange={setOpen}
        initialHoldings={initialHoldings}
        initialOverrides={initialOverrides}
      />
    </>
  );
}
```

⚠️ Phase 5 의 `StockAnalysisCard` (RSC) 가 `<SettingsButton>` 을 우상단에 배치. RSC 가 holdings + overrides 를 props 로 전달.

- [ ] **Step 3: typecheck + lint**

Run: `pnpm --filter @gons/dashboard typecheck && cd apps/dashboard && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/widgets/stock-analysis/
git commit -m "feat(stock-analysis): SettingsButton + PortfolioSettingsModal (Portfolio + LLM 탭 + 면책)"
```

---

## Task 4.7: 통합 검증 + PR

- [ ] **Step 1: 전체 typecheck**

Run: `pnpm typecheck`
Expected: 모든 패키지 PASS.

- [ ] **Step 2: dashboard lint**

Run: `cd apps/dashboard && pnpm lint`
Expected: PASS. boundary 위반 0.

- [ ] **Step 3: 전체 test**

Run: `pnpm test`
Expected: stock-analysis 35 PASS (변동 없음), saju 152 PASS, dashboard pre-existing 외 신규 fail 없음.

- [ ] **Step 4: 작업 commit 검증**

Run: `git log --oneline origin/main..HEAD`
Expected: 6 commit (T4.1~T4.6).

- [ ] **Step 5: branch push + PR 생성**

```bash
git push -u origin feat/stock-analysis-phase-4

gh pr create --title "feat(stock-analysis): Phase 4 — Portfolio CRUD UI" --body "$(cat <<'EOF'
## Summary
- Radix Dialog 기반 공통 Modal shell (shared/ui/Modal)
- Server Actions: addHolding / updateHolding / deleteHolding / setPersonaModel / resetPersonaModels (1액션 1파일)
- TickerSearchInput: Yahoo /api/stock/search + 300ms 디바운스 + 결과 드롭다운
- PortfolioTable + HoldingRow: 인라인 편집 (셀 클릭 → input, Enter/blur 저장, Esc 취소)
- PersonaModelPicker: 6명 × 3 모델 라디오 + optimistic update + rollback + 기본값 리셋
- PortfolioSettingsModal: Portfolio + LLM 탭 + 면책 footer
- SettingsButton: ⚙ → 모달 open (Phase 5 의 StockAnalysisCard 가 사용)

## Notes
- Radix UI Dialog 신규 도입 (dashboard 의 첫 모달 라이브러리)
- Server Action 패턴: dashboard 기존 패턴 미러 (1액션 1파일)
- 면책 footer: 모달 모든 탭 하단 (spec §5.3)
- 다른 사용자 row 수정 차단: WHERE id AND userId
- UNIQUE (user_id, symbol) 위반 시 친절 메시지

## Test plan
- [x] pnpm typecheck PASS
- [x] cd apps/dashboard && pnpm lint PASS (boundary 위반 0)
- [x] pnpm test (변동 없음 — Phase 4 는 UI 만)
- [ ] (수동) Phase 5 의 StockAnalysisCard 통합 후 실제 모달 열고 종목 추가/수정/삭제 + 모델 변경 검증

## Spec / Plan
- Spec: docs/superpowers/specs/2026-05-21-stock-analysis-widget-design.md §5.3 (설정 모달), §5.4 (autocomplete)
- Plan: docs/superpowers/plans/2026-05-21-stock-analysis-widget/phase-4-portfolio-crud.md

🤖 Generated with Claude Code
EOF
)"
```

---

## Phase 4 self-check

- [ ] `pnpm typecheck && (cd apps/dashboard && pnpm lint) && pnpm test` 모두 PASS
- [ ] Radix Dialog 정상 install (pnpm-lock.yaml 갱신)
- [ ] 5 Server Action 모두 NextAuth + Zod 검증
- [ ] PortfolioTable 인라인 편집 (셀 클릭 → input → blur/Enter 저장)
- [ ] PersonaModelPicker optimistic update + rollback
- [ ] 면책 footer 모달 하단 고정
- [ ] PR 머지 후 main Docker 빌드 success

Phase 4 PR 머지 후 Phase 5 (Widget Card + Detail Modal) 진입 — 실제 UI 통합 검증은 Phase 5 의 페이지 통합에서.

---

## 횡단 관심사 (Phase 4 갱신)

- **Modal 라이브러리 도입**: Radix UI Dialog. 접근성 자동 (focus trap, ESC, ARIA). 번들 ~10KB gzipped.
- **Server Action 패턴**: 1액션 1파일. dashboard 컨벤션 (`container-actions`, `email-analysis`) 미러.
- **Radix Dialog 빌드 issue 발생 시**: `next.config.ts` 의 `transpilePackages` 검토.
- **optimistic update + rollback**: PersonaModelPicker. UX 빠르지만 race condition 가능 (T3.4 우려 #3). v1 수용.
- **인라인 편집 UX**: 셀 클릭 → input → blur/Enter 저장 / Esc 취소. 모바일에서 onBlur 가 키보드 드롭다운으로 트리거될 수 있음 — Phase 5 dogfooding 시 확인.
- **`router.refresh()` + `revalidatePath("/")`**: 모달 변경이 외부 RSC 까지 fresh 화.
- **`resetPersonaModels`**: row 자체 삭제로 단순화. 다음 resolve 시 DEFAULT_PERSONA_MODELS 적용.
- **글로벌 캐시 vs 사용자별 모델 override** (Phase 3 우려): Phase 4 의 PersonaModelPicker 변경이 즉시 분석 결과에 영향 안 함 (캐시 hit 동안). 사용자가 분석 재생성 (Phase 6) 시점에 새 모델 사용. UX 명확화는 Phase 6 의 "재생성" 버튼 라벨로.
