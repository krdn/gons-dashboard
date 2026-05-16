const STANDARD_LONGITUDE_BY_TZ: Record<string, number> = {
  "Asia/Seoul": 135,
  "Asia/Tokyo": 135,
  "Asia/Shanghai": 120,
};

const HOUR_BRANCHES = ["子","丑","寅","卯","辰","巳","午","未","申","酉","戌","亥"] as const;

export interface ResolveInput {
  birthDateLocal: string;
  birthTimeLocal: string;
  timezone: string;
  longitudeDeg: number;
  calendar: "solar" | "lunar";
  gender: "male" | "female";
}

export interface ResolvedMoment {
  utcInstant: Date;
  trueSolarMinutesOffset: number;
  ambiguityWindow?: {
    boundaryHour: number;
    candidateBranches: [string, string];
  };
  hourKnown: boolean;
}

export function resolveTrueSolar(input: ResolveInput): ResolvedMoment {
  const standardLng = STANDARD_LONGITUDE_BY_TZ[input.timezone];
  if (standardLng === undefined) {
    throw new Error(
      `Unsupported timezone: ${input.timezone}. Supported: Asia/Seoul, Asia/Tokyo, Asia/Shanghai`,
    );
  }
  const minutesOffset = Math.round((input.longitudeDeg - standardLng) * 4);
  const hourKnown = input.birthTimeLocal.length > 0;

  if (!hourKnown) {
    const utc = new Date(`${input.birthDateLocal}T00:00:00${tzOffset(input.timezone)}`);
    return { utcInstant: utc, trueSolarMinutesOffset: minutesOffset, hourKnown: false };
  }

  const wallClock = new Date(`${input.birthDateLocal}T${input.birthTimeLocal}:00${tzOffset(input.timezone)}`);
  const trueSolar = new Date(wallClock.getTime() + minutesOffset * 60_000);

  // 시주 경계 감지: 진태양시 분(로컬) 기준으로 2시간 사이클의 ±5분 진입 여부
  const trueSolarLocalMinutes = (trueSolar.getUTCHours() * 60 + trueSolar.getUTCMinutes() + tzHourMinutes(input.timezone)) % 1440;
  const cycleOffset = (trueSolarLocalMinutes + 60) % 120;
  const ambiguity = cycleOffset <= 5 || cycleOffset >= 115;

  let ambiguityWindow: ResolvedMoment["ambiguityWindow"];
  if (ambiguity) {
    const branchIdx = Math.floor(((trueSolarLocalMinutes + 60) % 1440) / 120);
    let prev: string;
    let next: string;
    if (cycleOffset <= 5) {
      // 방금 새 지지로 진입 — 직전 지지와 모호
      prev = HOUR_BRANCHES[(branchIdx + 11) % 12]!;
      next = HOUR_BRANCHES[branchIdx]!;
    } else {
      // 다음 지지 경계로 접근 중 — 현재/다음 지지가 모호
      prev = HOUR_BRANCHES[branchIdx]!;
      next = HOUR_BRANCHES[(branchIdx + 1) % 12]!;
    }
    ambiguityWindow = {
      boundaryHour: Math.round(trueSolarLocalMinutes / 60),
      candidateBranches: [prev, next],
    };
  }

  return {
    utcInstant: trueSolar,
    trueSolarMinutesOffset: minutesOffset,
    ambiguityWindow,
    hourKnown: true,
  };
}

function tzOffset(timezone: string): string {
  const offsets: Record<string, string> = {
    "Asia/Seoul": "+09:00",
    "Asia/Tokyo": "+09:00",
    "Asia/Shanghai": "+08:00",
  };
  return offsets[timezone] ?? "+00:00";
}

function tzHourMinutes(timezone: string): number {
  const offsets: Record<string, number> = {
    "Asia/Seoul": 9 * 60,
    "Asia/Tokyo": 9 * 60,
    "Asia/Shanghai": 8 * 60,
  };
  return offsets[timezone] ?? 0;
}
