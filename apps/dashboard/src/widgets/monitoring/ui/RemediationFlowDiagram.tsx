// 자동 복구 파이프라인 다이어그램 — 보드 판독을 돕는 참고 자료 (이슈 #352).
// 소스: docs/diagrams/auto-remediation-flow.excalidraw — 수정 시 재렌더해
// public/diagrams/auto-remediation-flow.png 를 교체한다.
import "server-only";
import Image from "next/image";

const DIAGRAM_SRC = "/diagrams/auto-remediation-flow.png";

export function RemediationFlowDiagram() {
  return (
    <details className="rounded-xl border border-[var(--color-hairline)] bg-white p-4">
      <summary className="cursor-pointer text-base font-semibold tracking-tight">
        자동 복구 프로세스 다이어그램
        <span className="ml-2 text-xs font-medium text-[var(--color-text-muted)]">
          동작 원리 · outcome 판독 · 설계 판단 (클릭해 펼치기)
        </span>
      </summary>
      <a href={DIAGRAM_SRC} target="_blank" rel="noreferrer">
        <Image
          src={DIAGRAM_SRC}
          alt="자동 복구 파이프라인: open 이벤트 → 5분 사이클(고아 정리→조회→이력→정책 매칭→가드→claim→실행/dry-run→settle) → outcome(skipped/in_flight/dry_run/executed/failed) → 보드 검토"
          width={7120}
          height={4888}
          unoptimized
          loading="lazy"
          className="mt-3 h-auto w-full rounded-lg border border-[var(--color-hairline)]"
        />
      </a>
      <p className="mt-2 text-xs text-[var(--color-text-muted)]">
        새 탭에서 원본을 열면 확대해 읽을 수 있습니다. 배지 의미: ○ 스킵(조건
        미충족, 사유 기록) · ◐ dry-run(계획만) · ✓ 실행됨 · ✕ 실패(+reason) · …
        진행중.
      </p>
    </details>
  );
}
