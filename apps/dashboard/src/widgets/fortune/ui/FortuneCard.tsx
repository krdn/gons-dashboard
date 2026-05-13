import "server-only";
import { listFortuneProfiles } from "@/entities/fortune-profile";
import { getTodayDailyFortunesForUser } from "@/entities/saju-chart";
import { auth } from "@/shared/lib/auth";
import { FortuneCardClient } from "./FortuneCardClient";

function kstTodayDate(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export async function FortuneCard() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const profiles = await listFortuneProfiles(session.user.id);
  const today = kstTodayDate();
  const fortunes = await getTodayDailyFortunesForUser(session.user.id, today);

  // Map → plain object (Client component prop으로 직렬화 가능하게)
  const fortunesByProfile: Record<
    string,
    {
      forDate: string;
      dayStem: string;
      dayBranch: string;
      payload: unknown;
    }
  > = {};
  for (const [pid, row] of fortunes) {
    fortunesByProfile[pid] = {
      forDate: row.forDate,
      dayStem: row.dayStem,
      dayBranch: row.dayBranch,
      payload: row.payload,
    };
  }

  return (
    <FortuneCardClient
      profiles={profiles}
      fortunesByProfile={fortunesByProfile}
      today={today}
    />
  );
}
