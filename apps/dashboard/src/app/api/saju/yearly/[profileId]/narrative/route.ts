import {
  getOrBuildYearly,
  YearlyBuildError,
  currentKstYear,
} from "@/features/saju-yearly-tri/api/yearly-server";
import { getOrBuildYearlyNarrative } from "@/features/saju-yearly-tri/api/narrative-server";
import { createNarrativeHandler } from "@/shared/lib/saju/createNarrativeHandler";

const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

export const GET = createNarrativeHandler<{ targetYear: number }>({
  name: "yearly",
  keyPrefix: "yearly",
  parseParams(searchParams) {
    const yearParam = searchParams.get("year");
    if (yearParam === null) {
      return { ok: true, params: { targetYear: currentKstYear() } };
    }
    const parsed = Number(yearParam);
    if (!Number.isInteger(parsed) || parsed < MIN_YEAR || parsed > MAX_YEAR) {
      return { ok: false, code: "INVALID_YEAR", status: 400 };
    }
    return { ok: true, params: { targetYear: parsed } };
  },
  async buildAndNarrate({ profileId, userId, school, frameKey, params, modelId }) {
    const yearly = await getOrBuildYearly(profileId, userId, params.targetYear);
    const frame = yearly.triNation.frames[frameKey];
    return getOrBuildYearlyNarrative(profileId, school, params.targetYear, frame, modelId);
  },
  buildErrorClass: YearlyBuildError,
});
