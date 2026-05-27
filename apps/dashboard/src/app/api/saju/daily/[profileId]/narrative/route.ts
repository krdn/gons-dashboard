import {
  getOrBuildDaily,
  DailyBuildError,
} from "@/features/saju-daily-tri/api/daily-server";
import { getOrBuildDailyNarrative } from "@/features/saju-daily-tri/api/narrative-server";
import { currentKstDate } from "@/shared/lib/saju/resolveBirthInput";
import { createNarrativeHandler } from "@/shared/lib/saju/createNarrativeHandler";

function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export const GET = createNarrativeHandler<{ forDate: string }>({
  name: "daily",
  keyPrefix: "daily",
  parseParams(searchParams) {
    const forDateParam = searchParams.get("forDate");
    const forDate = forDateParam ?? currentKstDate();
    if (!isValidDate(forDate)) {
      return { ok: false, code: "INVALID_DATE", status: 400 };
    }
    return { ok: true, params: { forDate } };
  },
  async buildAndNarrate({ profileId, userId, school, frameKey, params, modelId }) {
    const daily = await getOrBuildDaily(profileId, userId, params.forDate);
    const frame = daily.triNation.frames[frameKey];
    return getOrBuildDailyNarrative(profileId, school, params.forDate, frame, modelId);
  },
  buildErrorClass: DailyBuildError,
});
