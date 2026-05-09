// 빈 상태 — 최근 7일간 중요 메일이 없을 때.
export function ImportantEmailsEmpty() {
  return (
    <div className="rounded-lg border border-dashed border-[var(--color-border)] p-6 text-sm text-[var(--color-text-muted)]">
      최근 7일간 알아둘 만한 메일이 없습니다.
    </div>
  );
}
