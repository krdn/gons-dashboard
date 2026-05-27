import type { SajuChart, Pillar, TenGod, MonthPillar } from "@krdn/saju";

// 프롬프트 내용이 의미 있게 바뀔 때마다 -v2, -v3 으로 올린다.
// 캐시-리딩 모듈이 (model, promptVersion) 키로 옛 응답을 stale 처리.
export const YEARLY_PROMPT_VERSION = "yearly-v1";

const SYSTEM_PROMPT = [
  "당신은 명리학자입니다.",
  "한자 + 한글 음을 병기하고, 추측·점성술 톤은 피하고,",
  "사주 구조에서 도출되는 결론만 제시합니다.",
  "출력은 한국어 markdown text. 헤더(#)는 쓰지 말고 굵은 라벨(**) + 단락만.",
].join(" ");

export interface BuildYearlyPromptInput {
  chart: SajuChart;
  year: number;
  yearPillar: Pillar;
  yearTenGods: { stemTenGod: TenGod; branchTenGod: TenGod };
  monthPillars: MonthPillar[];
  monthTenGods: Array<{ stemTenGod: TenGod; branchTenGod: TenGod }>;
}

export function buildYearlyPrompt(input: BuildYearlyPromptInput): {
  system: string;
  user: string;
  version: typeof YEARLY_PROMPT_VERSION;
} {
  const monthLines = input.monthPillars.map((mp, i) => {
    const tg = input.monthTenGods[i];
    return `${mp.monthIndex}월 (${mp.startSolarDate}~): ${mp.pillar.stem}${mp.pillar.branch} — 천간 ${tg.stemTenGod}, 지지 ${tg.branchTenGod}`;
  });

  const user = [
    "[명주 정보]",
    JSON.stringify(
      {
        pillars: input.chart.pillars,
        strength: input.chart.strength,
        pattern: input.chart.pattern,
        yongSin: input.chart.yongSin,
        giSin: input.chart.giSin,
      },
      null,
      2,
    ),
    "",
    `[${input.year}년 세운]`,
    `간지: ${input.yearPillar.stem}${input.yearPillar.branch}`,
    `십신: 천간 ${input.yearTenGods.stemTenGod}, 지지 ${input.yearTenGods.branchTenGod}`,
    "",
    "[월별 12개 간지]",
    ...monthLines,
    "",
    "[출력 요구]",
    "다음 구조의 한국어 markdown text 로 응답. 헤더(#) 금지, 굵은 라벨(**) + 단락만.",
    "",
    `**올해 전체 흐름** — ${input.year}년 ${input.yearPillar.stem}${input.yearPillar.branch}년이 일간에 미치는 영향. 용신·기신과의 관계, 신왕/신약 변동, 한 해의 큰 그림 (3~4문장).`,
    "",
    "**1월** — 절기 기준 시작일·간지·십신 짚고 한 줄 풀이 (1~2문장)",
    "**2월** ...",
    "**3월** ...",
    "**4월** ...",
    "**5월** ...",
    "**6월** ...",
    "**7월** ...",
    "**8월** ...",
    "**9월** ...",
    "**10월** ...",
    "**11월** ...",
    "**12월** ...",
    "",
    "**올해의 핵심 조언** — 용신·기신 + 세운 + 강세 월을 묶어 행동 지침 (2~3문장).",
    "",
    "전체 길이: 약 1200~1500자.",
  ].join("\n");

  return { system: SYSTEM_PROMPT, user, version: YEARLY_PROMPT_VERSION };
}
