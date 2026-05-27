import {
  getOrBuildMonthly,
  MonthlyBuildError,
  currentKstMonth,
  currentKstYear,
} from "@/features/saju-monthly-tri/api/monthly-server";
import { getOrBuildMonthlyNarrative } from "@/features/saju-monthly-tri/api/narrative-server";
import { createNarrativeHandler } from "@/shared/lib/saju/createNarrativeHandler";

const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

export const GET = createNarrativeHandler<{ targetYear: number; targetMonth: number }>({
  name: "monthly",
  keyPrefix: "monthly",
  parseParams(searchParams) {
    const yearParam = searchParams.get("year");
    let targetYear: number;
    if (yearParam === null) {
      targetYear = currentKstYear();
    } else {
      const parsed = Number(yearParam);
      if (!Number.isInteger(parsed) || parsed < MIN_YEAR || parsed > MAX_YEAR) {
        return { ok: false, code: "INVALID_YEAR", status: 400 };
      }
      targetYear = parsed;
    }

    const monthParam = searchParams.get("month");
    let targetMonth: number;
    if (monthParam === null) {
      targetMonth = currentKstMonth();
    } else {
      const parsed = Number(monthParam);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 12) {
        return { ok: false, code: "INVALID_MONTH", status: 400 };
      }
      targetMonth = parsed;
    }

    return { ok: true, params: { targetYear, targetMonth } };
  },
  async buildAndNarrate({ profileId, userId, school, frameKey, params, modelId }) {
    const monthly = await getOrBuildMonthly(profileId, userId, params.targetYear, params.targetMonth);
    const frame = monthly.triNation.frames[frameKey];
    return getOrBuildMonthlyNarrative(profileId, school, params.targetYear, params.targetMonth, frame, modelId);
  },
  buildErrorClass: MonthlyBuildError,
});
