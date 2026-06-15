// 메인 위젯 — RSC. 사용자의 reply_needed TOP 5 표시.
//
// 와이어프레임의 좌측 메인 컬럼 (.col-main) 영역을 채움.
// 데이터 로드는 entities/email/getReplyNeeded — features 거치지 않음 (FSD: widgets → entities OK).

import { auth } from "@/shared/lib/auth";
import { getReplyNeeded } from "@/entities/email";
import { ReplyCard } from "./ReplyCard";
import { EmailDigestEmpty } from "./EmailDigestEmpty";

export async function EmailDigestCard() {
  const session = await auth();
  if (!session?.user?.id) {
    // 로그인 안 된 상태는 호출 측에서 미리 처리해야 하지만 안전장치.
    return null;
  }

  const items = await getReplyNeeded(session.user.id, { limit: 5 });

  return (
    <section
      aria-labelledby="reply-needed-heading"
      className="col-span-1 max-w-[760px]"
    >
      <h2
        id="reply-needed-heading"
        className="mb-4 flex items-baseline gap-2 text-base font-semibold tracking-tight text-[var(--color-text)]"
      >
        <span>오늘 답장 필요</span>
        <span className="font-mono text-xs font-medium tabular-nums text-[var(--color-text-muted)]">
          {items.length}
        </span>
      </h2>

      {items.length === 0 ? (
        <EmailDigestEmpty />
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <ReplyCard key={item.threadId} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}
