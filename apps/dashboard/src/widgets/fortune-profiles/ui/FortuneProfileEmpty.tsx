export function FortuneProfileEmpty() {
  return (
    <div className="rounded-xl border border-dashed border-[var(--color-hairline-strong)] bg-[var(--color-surface)] px-6 py-10 text-center">
      <p className="text-sm text-[var(--color-text-muted)]">
        아직 등록된 사주 프로필이 없어요.
      </p>
      <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
        본인 또는 가족·지인의 사주를 추가하면 위젯에서 운세를 볼 수 있어요.
      </p>
    </div>
  );
}
