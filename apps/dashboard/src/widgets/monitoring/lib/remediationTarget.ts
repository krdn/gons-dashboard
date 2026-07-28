// 자동 복구 시도 행의 조치 대상 추출 (findings §3).
//
// detail 은 runCycle 이 저장한 JSON.stringify(RemediationAction) — 대상
// 식별자(containerName·target 등)가 여기에만 있다. Phase 1 의 목적은 사람이
// dry-run 계획을 검토하는 것이므로, 대상이 안 보이면 보드의 존재 이유가 없다.
import { formatMib } from "./format";

/** 사람이 검토할 대상 식별자. 뽑을 것이 없으면 null — 보드는 dedupKey 로 보완. */
export function remediationTarget(detail: string | null): string | null {
  if (detail == null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(detail);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed == null) return null;
  const d = parsed as Record<string, unknown>;

  if (typeof d.containerName === "string") {
    const id =
      typeof d.containerId === "string" ? ` (${d.containerId.slice(0, 12)})` : "";
    return `${d.containerName}${id}`;
  }
  if (typeof d.target === "string") {
    const next =
      typeof d.nextBytes === "number"
        ? ` → ${formatMib(d.nextBytes / 1024 ** 2)}`
        : "";
    return `${d.target}${next}`;
  }
  return null;
}
