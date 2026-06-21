"use client";

import { useMemo, useState } from "react";
import {
  loadKb,
  lookup,
  DRUG_CLASSES,
  SUPPLEMENTS,
  type LookupResult,
} from "@krdn/gons-health";
import { SupplementResult } from "./SupplementResult";

// 인터랙티브 위젯이라 클라이언트 컴포넌트.
// lookup 은 순수 함수(런타임 deps 0)라 서버 왕복 없이 브라우저에서 즉시 결과.
// = 약사용 "1초 안에 확인" 요구와 정합.

export function SupplementCheckerCard() {
  // KB 는 컴포넌트 생애 1회 검증(validateKb 통과). 마운트마다 재검증 방지.
  const kb = useMemo(() => loadKb(), []);
  const [drugClass, setDrugClass] = useState("");
  const [supplement, setSupplement] = useState("");
  const [result, setResult] = useState<LookupResult | null>(null);

  const canCheck = drugClass !== "" && supplement !== "";

  function handleCheck() {
    if (!canCheck) return;
    setResult(lookup(kb, drugClass, supplement));
  }

  const selectClass =
    "rounded-md border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none";

  return (
    <section className="rounded-xl border border-[var(--color-hairline)] bg-white p-4 text-[var(--color-text)]">
      <header className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">건기식 상호작용 체커</h3>
        <span className="text-xs text-[var(--color-text-subtle)]">
          처방약 × 건기식/식품
        </span>
      </header>
      <p className="mb-3 text-xs text-[var(--color-text-subtle)]">
        문서화된 상호작용을 확인합니다. 정보 제공용이며 최종 판단은 약사가 합니다.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
          처방약 클래스
          <select
            value={drugClass}
            className={selectClass}
            onChange={(e) => {
              setDrugClass(e.target.value);
              setResult(null);
            }}
          >
            <option value="">— 선택 —</option>
            {DRUG_CLASSES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
          추천 건기식/식품
          <select
            value={supplement}
            className={selectClass}
            onChange={(e) => {
              setSupplement(e.target.value);
              setResult(null);
            }}
          >
            <option value="">— 선택 —</option>
            {SUPPLEMENTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={handleCheck}
          disabled={!canCheck}
          className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          확인
        </button>
      </div>

      {result && (
        <div className="mt-3">
          <SupplementResult result={result} />
        </div>
      )}
    </section>
  );
}
