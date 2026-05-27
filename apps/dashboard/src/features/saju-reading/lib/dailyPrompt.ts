import type { SajuChart, Pillar, TenGod } from "@krdn/saju";

// 프롬프트 내용이 의미 있게 바뀔 때마다 -v2, -v3 으로 올린다.
// 캐시-리딩 모듈이 (model, promptVersion) 키로 옛 응답을 stale 처리.
export const DAILY_PROMPT_VERSION = "daily-v1";

const SYSTEM_PROMPT = [
  "당신은 명리학자입니다.",
  "한자 + 한글 음을 병기하고, 추측·점성술 톤은 피하고,",
  "사주 구조에서 도출되는 결론만 제시합니다.",
  "응답은 반드시 다음 JSON 스키마로만, 다른 텍스트 없이.",
].join(" ");

const OUTPUT_SCHEMA = `{
  "summary": "string (한 문장, 한자 병기)",
  "overallScore": 1~5 정수,
  "scores": [
    { "label": "재물", "score": 1~5, "note": "한 문장" },
    { "label": "일", "score": 1~5, "note": "..." },
    { "label": "관계", "score": 1~5, "note": "..." },
    { "label": "건강", "score": 1~5, "note": "..." },
    { "label": "학습", "score": 1~5, "note": "..." }
  ],
  "hourly": [
    { "range": "05–07", "vibe": "string", "isGolden": false },
    { "range": "07–09", "vibe": "..." },
    { "range": "09–11", "vibe": "..." },
    { "range": "11–13", "vibe": "..." },
    { "range": "13–15", "vibe": "..." },
    { "range": "15–17", "vibe": "...", "isGolden": true or false },
    { "range": "17–19", "vibe": "..." },
    { "range": "19–21", "vibe": "..." }
  ],
  "recommendations": ["string", "string", ...],
  "cautions": ["string", "string", ...],
  "remedy": {
    "colors": ["string", ...],
    "directions": ["string", ...],
    "foods": ["string", ...],
    "items": ["string", ...]
  },
  "closing": "string (한 문장)"
}`;

export interface BuildDailyPromptInput {
  chart: SajuChart;
  dayPillar: Pillar;
  tenGods: { stemTenGod: TenGod; branchTenGod: TenGod };
  forDate: string;
  retryWithEmphasis?: boolean;
}

export function buildDailyPrompt(input: BuildDailyPromptInput): {
  system: string;
  user: string;
  version: typeof DAILY_PROMPT_VERSION;
} {
  const system = input.retryWithEmphasis
    ? `${SYSTEM_PROMPT}\n\n반드시 JSON만, 다른 텍스트(설명/마크다운 코드블록 포함) 절대 금지.`
    : SYSTEM_PROMPT;

  const user = [
    "[명주 정보]",
    JSON.stringify(
      {
        pillars: input.chart.pillars,
        elements: input.chart.elements,
        strength: input.chart.strength,
        pattern: input.chart.pattern,
        yongSin: input.chart.yongSin,
        giSin: input.chart.giSin,
      },
      null,
      2,
    ),
    "",
    "[오늘 일진]",
    `${input.dayPillar.stem}${input.dayPillar.branch} (${input.forDate})`,
    `십신: 천간 ${input.tenGods.stemTenGod}, 지지 ${input.tenGods.branchTenGod}`,
    "",
    "[출력 스키마]",
    OUTPUT_SCHEMA,
    "",
    "위 스키마로만 JSON 응답.",
  ].join("\n");

  return { system, user, version: DAILY_PROMPT_VERSION };
}
