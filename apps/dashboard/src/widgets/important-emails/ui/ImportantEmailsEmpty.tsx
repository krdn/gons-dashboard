// 빈 상태 — windowDays 기간 내 중요 메일이 없을 때.
// 7일 하드코딩 금지 — 형제 EmailDigestCard 처럼 사용자 설정(windowDays) 반영.
export function ImportantEmailsEmpty({ windowDays }: { windowDays: number }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--color-hairline)] p-6 text-sm text-[var(--color-text-muted)]">
      최근 {windowDays}일간 알아둘 만한 메일이 없습니다.
    </div>
  );
}
