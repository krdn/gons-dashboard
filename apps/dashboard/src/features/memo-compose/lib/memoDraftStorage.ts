// 승인 전 메모 초안 — 이 기기 localStorage에만 임시 저장 (유실 방지, 서버 무저장).
const KEY = "memo-draft-v1";

export interface MemoDraft {
  rawContent: string;
  cleanedContent: string;
  title: string;
  savedAt: number;
}

export function saveDraft(d: MemoDraft): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* quota 초과 등 — 초안 저장은 best-effort */
  }
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
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
