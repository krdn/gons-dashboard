import type { ReadingSection } from "@/entities/saju-chart";
import type { SajuChart } from "@krdn/saju";

const SAJU_SYSTEM_PROMPT = [
  "당신은 명리학자입니다.",
  "한자 + 한글 음을 병기하고, 추측·점성술 톤은 피하고,",
  "사주 구조에서 도출되는 결론만 제시합니다.",
  "출력은 한국어 markdown text. 헤더(#)는 쓰지 말고 단락 문장만.",
].join(" ");

// 프롬프트 내용이 의미 있게 바뀔 때마다 -v2, -v3 으로 올린다.
// 캐시-리딩 모듈이 (model, promptVersion) 키로 옛 응답을 stale 처리.
export const SECTION_PROMPT_VERSION = "section-v1";

const SECTION_INSTRUCTIONS: Record<ReadingSection, { instruction: string; targetChars: number }> = {
  overview:      { instruction: "이 사주의 구조적 특징(관인상생, 신강·신약, 격국 등)을 한 문단으로 종합 풀이. 약 300자.",                                       targetChars: 300 },
  personality:   { instruction: "성격·기질을 사주 구조에서 도출. 강점과 그림자 양면을 모두 다룰 것. 약 200자.",                                                    targetChars: 200 },
  career:        { instruction: "직업·적성을 십신·격국 기반으로 도출. 구체적 직군 2~3개 제시. 약 200자.",                                                          targetChars: 200 },
  health:        { instruction: "오행 결함·과다를 기준으로 건강 주의 영역. 추상적 표현 금지. 약 150자.",                                                            targetChars: 150 },
  major_fortune: {
    instruction: [
      "대운 10개를 다음 형식으로 정확히 출력 (각 항목 독립 단락):",
      "",
      "**N세 XY (YYYY~)** — N세 시작 대운 풀이 2~3문장",
      "",
      "예시:",
      "**8세 壬寅 (1974~)** — 편관 대운으로 청소년기 학업·진로 압박. 寅木이 일간을 생하지 못해...",
      "",
      "10개 단락 끝에 빈 줄 + 종합 단락 1개 추가:",
      "**올해 흐름** — 현재 대운과 세운의 관계 (2~3문장).",
      "",
      "전체 약 800자.",
    ].join("\n"),
    targetChars: 800,
  },
};

export interface BuildReadingPromptInput {
  chart: SajuChart;
  section: ReadingSection;
  currentAge?: number;
}

export function buildReadingPrompt(input: BuildReadingPromptInput): {
  system: string;
  user: string;
  version: typeof SECTION_PROMPT_VERSION;
} {
  const { chart, section, currentAge } = input;
  const sectionMeta = SECTION_INSTRUCTIONS[section];

  // 차트 결정적 결과만 프롬프트에 — PII(생일·이름·도시) 직접 안 넣음 (spec §8)
  const chartJson = JSON.stringify(
    {
      pillars: chart.pillars,
      elements: chart.elements,
      strength: chart.strength,
      tenGods: chart.tenGods,
      pattern: chart.pattern,
      yongSin: chart.yongSin,
      giSin: chart.giSin,
      majorFortunes: chart.majorFortunes,
      currentAge: currentAge ?? null,
    },
    null,
    2,
  );

  const user = [
    "[사주 차트]",
    chartJson,
    "",
    "[섹션 지시]",
    sectionMeta.instruction,
    `목표 길이: 약 ${sectionMeta.targetChars}자.`,
  ].join("\n");

  return { system: SAJU_SYSTEM_PROMPT, user, version: SECTION_PROMPT_VERSION };
}
