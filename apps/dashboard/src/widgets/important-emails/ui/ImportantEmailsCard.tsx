// 중요 메일 위젯 — RSC. important_emails 표시(개수·윈도·필터는 설정값).
//
// FSD: widgets → entities OK. 데이터 로드는 entities/email/getImportantEmails.
// D6 답장 우선 정책은 entities 레이어에서 LEFT JOIN으로 처리됨.
import { auth } from "@/shared/lib/auth";
import { getImportantEmails } from "@/entities/email";
import { getEmailSettings } from "@/entities/email-settings";
import { EmailSettingsDialog } from "@/features/email-settings-manage/client";
import { ImportantEmailRow } from "./ImportantEmailRow";
import { ImportantEmailsEmpty } from "./ImportantEmailsEmpty";

export async function ImportantEmailsCard() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const settings = await getEmailSettings(session.user.id);
  const items = await getImportantEmails(session.user.id, {
    limit: settings.importantLimit,
    windowDays: settings.windowDays,
    importanceThreshold: settings.importantThreshold,
    categories: settings.categories,
  });

  return (
    <section
      aria-labelledby="important-emails-heading"
      className="col-span-1 max-w-[760px]"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2
          id="important-emails-heading"
          className="flex items-baseline gap-2 text-base font-semibold tracking-tight text-[var(--color-text)]"
        >
          <span>최근 중요 메일</span>
          <span className="font-mono text-xs font-medium tabular-nums text-[var(--color-text-muted)]">
            {items.length}
          </span>
        </h2>
        <EmailSettingsDialog initial={settings} />
      </div>

      {items.length === 0 ? (
        <ImportantEmailsEmpty />
      ) : (
        <div role="list" className="flex flex-col gap-3">
          {items.map((item) => (
            <ImportantEmailRow key={item.threadId} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}
