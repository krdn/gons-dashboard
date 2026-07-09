// 승인 전 메모 초안 — 이 기기 localStorage에만 임시 저장 (유실 방지, 서버 무저장).
const KEY = "memo-draft-v1";

export interface MemoDraft {
  rawContent: string;
  cleanedContent: string;
  title: string;
  savedAt: number;
}

// useSyncExternalStore용 스냅샷 캐시 + 구독 — 복원 배너가 참조 안정성(getSnapshot
// 동일 참조)을 요구하므로 매 호출 JSON.parse 하지 않는다.
let cache: MemoDraft | null | undefined; // undefined = 아직 localStorage 미조회
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function subscribeDraft(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getDraftSnapshot(): MemoDraft | null {
  if (cache === undefined) cache = loadDraft();
  return cache;
}

export function saveDraft(d: MemoDraft): void {
  cache = d; // storage 실패해도 세션 내 메모리 초안은 유지 (best-effort).
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* quota 초과 등 — 초안 저장은 best-effort */
  }
  emit();
}

export function loadDraft(): MemoDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as MemoDraft;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  cache = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  emit();
}
