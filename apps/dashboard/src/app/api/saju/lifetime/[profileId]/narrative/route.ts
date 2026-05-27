import {
  getOrBuildLifetime,
  LifetimeBuildError,
} from "@/features/saju-lifetime-tri/api/lifetime-server";
import { getOrBuildNarrative } from "@/features/saju-lifetime-tri/api/narrative-server";
import { createNarrativeHandler } from "@/shared/lib/saju/createNarrativeHandler";

export const GET = createNarrativeHandler<Record<string, never>>({
  name: "lifetime",
  keyPrefix: "lifetime",
  parseParams: () => ({ ok: true, params: {} as Record<string, never> }),
  async buildAndNarrate({ profileId, userId, school, frameKey, modelId }) {
    const lifetime = await getOrBuildLifetime(profileId, userId);
    const frame = lifetime.triNation.frames[frameKey];
    return getOrBuildNarrative(profileId, school, frame, modelId);
  },
  buildErrorClass: LifetimeBuildError,
});
