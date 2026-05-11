// 빈 상태 — 와이어프레임 D7 결정대로 아이콘 제거, 타이포·인용구로만.
// 빈 상태가 자주 보이는 화면이라 "보상이 되도록" 의도적 따뜻함.

export function EmailDigestEmpty() {
  return (
    <div
      role="status"
      className="rounded-xl border border-dashed border-[var(--color-hairline-strong)] bg-[var(--color-surface)] px-6 py-12"
    >
      <h3 className="mb-3 text-h1 font-bold tracking-tight text-[var(--color-text)]">
        오늘 답장할 메일이 없습니다.
      </h3>
      <p className="mb-0 text-sm text-[var(--color-text-muted)]">
        지난 24시간 받은 메일을 살펴봤지만, 누군가가 당신을 기다리는 메일은
        없었어요.
        <br />
        산뜻한 아침입니다.
      </p>
      <p className="mt-6 border-t border-[var(--color-hairline)] pt-4 text-xs italic text-[var(--color-text-subtle)]">
        &ldquo;대답이 너무 많은 곳에는 더 이상 질문이 없다.&rdquo; — 한병철
      </p>
    </div>
  );
}
