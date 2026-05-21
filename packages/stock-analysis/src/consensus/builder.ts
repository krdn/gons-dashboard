import type { BuiltPrompt } from "../personas/types";
import type { PersonaAnalysis, Verdict } from "../schemas/persona";

const SYSTEM = `당신은 투자 위원회의 의장입니다. 5명의 페르소나 (월스트리트 / 한국 전문가 / 가치 / 성장 / 기술적) 가 같은 종목을 각자 분석했습니다.
당신의 임무: 다수결로 종합 평가 (BUY/HOLD/SELL) 를 결정하고, 공통 의견과 의견이 갈리는 지점, 핵심 리스크 순위를 정리합니다.

엄격한 제약:
- 페르소나가 제시한 사실 (verdict, oneLineThesis, narrative) 만 종합. 새로운 데이터 추가 금지.
- 다수결: 5명 중 BUY 가 가장 많으면 BUY, 동률이면 HOLD 가 안전한 선택.
- score: "<BUY 수>/5" 형식 (예: "4/5"). 실패 페르소나는 0 vote 로 카운트 — denominator 항상 5.
- agreements: 모든/대부분의 페르소나가 동의한 포인트 (0-5 개).
- disagreements: 의견이 갈린 지점 (0-5 개).
- riskRanking: 페르소나들이 언급한 리스크를 중요도 순으로 정렬 (1-5 개).
- 본 분석은 가상 AI 페르소나의 종합 의견이며 투자자문이 아닙니다.`;

export function buildConsensusPrompt(
  personaResults: PersonaAnalysis[],
  modelUsed: "claude" | "codex" | "gemini",
): BuiltPrompt {
  return {
    system: SYSTEM,
    user: `5 페르소나 분석 결과 (성공: ${personaResults.length}명):

${personaResults
  .map(
    (p) => `── ${p.persona} (${p.modelUsed})
verdict: ${p.verdict}
oneLineThesis: ${p.oneLineThesis}
narrative: ${p.narrative}
risks: ${JSON.stringify(p.risks)}
keyMetrics: ${JSON.stringify(p.keyMetrics)}`,
  )
  .join("\n\n")}

응답 형식 (JSON only):
{
  "verdict": "BUY" | "HOLD" | "SELL",
  "score": "<count>/5",
  "oneLineConsensus": "30-300자 한국어 종합 한 줄",
  "agreements": ["공통 의견1"],
  "disagreements": ["갈린 지점1"],
  "riskRanking": ["가장 중요한 리스크1", "리스크2"],
  "modelUsed": "${modelUsed}",
  "successfulPersonas": ${JSON.stringify(personaResults.map((p) => p.persona))},
  "failedPersonas": []
}`,
  };
}

/**
 * 페르소나 결과의 다수결 verdict 를 미리 계산 (LLM 검증용 + fallback consensus).
 * Denominator 항상 5 (실패 페르소나는 abstain).
 */
export function tallyVerdicts(personaResults: PersonaAnalysis[]): {
  majority: Verdict;
  score: string;
  counts: Record<Verdict, number>;
} {
  const counts: Record<Verdict, number> = { BUY: 0, HOLD: 0, SELL: 0 };
  for (const p of personaResults) counts[p.verdict]++;
  const sorted = (["BUY", "HOLD", "SELL"] as Verdict[]).sort(
    (a, b) => counts[b] - counts[a],
  );
  const top = sorted[0];
  const second = sorted[1];
  // 동률 시 HOLD 우선 (안전한 선택)
  const majority = counts[top] === counts[second] ? "HOLD" : top;
  return { majority, score: `${counts[majority]}/5`, counts };
}
