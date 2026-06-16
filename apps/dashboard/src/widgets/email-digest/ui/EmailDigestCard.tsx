// 메인 위젯 — RSC. 사용자의 reply_needed 표시(개수·윈도·임계값은 설정값).
//
// 와이어프레임의 좌측 메인 컬럼 (.col-main) 영역을 채움.
// 데이터 로드는 entities/email/getReplyNeeded — features 거치지 않음 (FSD: widgets → entities OK).

import { auth } from "@/shared/lib/auth";
import { getReplyNeeded } from "@/entities/email";
import { getEmailSettings } from "@/entities/email-settings";
import { EmailSettingsDialog } from "@/features/email-settings-manage/client";
import { ReplyCard } from "./ReplyCard";
import { EmailDigestEmpty } from "./EmailDigestEmpty";

export async function EmailDigestCard() {
  const session = await auth();
  if (!session?.user?.id) {
    // 로그인 안 된 상태는 호출 측에서 미리 처리해야 하지만 안전장치.
    return null;
  }

  const settings = await getEmailSettings(session.user.id);
  const items = await getReplyNeeded(session.user.id, {
    limit: settings.replyNeededLimit,
    windowDays: settings.windowDays,
    severityThreshold: settings.replySeverityThreshold,
  });

  return (
    <section
      aria-labelledby="reply-needed-heading"
      className="col-span-1 max-w-[760px]"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2
          id="reply-needed-heading"
          className="flex items-baseline gap-2 text-base font-semibold tracking-tight text-[var(--color-text)]"
        >
          <span>답장 필요</span>
          <span className="font-mono text-xs font-medium tabular-nums text-[var(--color-text-muted)]">
            {items.length}
          </span>
          <span className="text-xs font-normal text-[var(--color-text-muted)]">
            최근 {settings.windowDays}일
          </span>
        </h2>
        <EmailSettingsDialog initial={settings} />
      </div>

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
