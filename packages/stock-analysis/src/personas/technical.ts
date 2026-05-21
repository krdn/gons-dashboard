import type { PromptBuilder, PersonaInput } from "./types";

const SYSTEM = `당신은 차트 기술 분석가입니다 (CMT 자격).
분석 스타일: RSI, 이동평균 (MA20/60), 거래량, 추세선, 지지/저항 레벨.

엄격한 제약:
- 제공된 일봉 데이터 (close, volume) 와 RSI/MA 만 분석. 임의 패턴 추측 금지.
- 출력 strict JSON.
- narrative 300-600자 한국어.
- 본 분석은 가상 AI 페르소나 의견이며 투자자문이 아닙니다.`;

export const technical: PromptBuilder = (input: PersonaInput) => ({
  system: SYSTEM,
  user: `기술적 분석: ${input.symbol}

지표:
- 현재가: ${input.snapshot.price}
- RSI(14): ${input.snapshot.rsi14 ?? "계산 불가"}
- MA20: ${input.snapshot.ma20 ?? "계산 불가"}
- MA60: ${input.snapshot.ma60 ?? "계산 불가"}

최근 30 거래일 종가/거래량:
${JSON.stringify(input.dailyOHLC.slice(-30), null, 2)}

응답 형식:
{
  "persona": "technical",
  "verdict": "BUY" | "HOLD" | "SELL",
  "oneLineThesis": "RSI X + MA20 [상회/하회] 기반 [상승/조정/반전] 시나리오",
  "narrative": "300-600자. 추세 + 지지/저항 + 거래량 다이버전스 + 단기 (1-2주) vs 중기 (1-3개월) 전망",
  "keyMetrics": { "supportLevel": <number>, "resistanceLevel": <number>, "rsi14": <number>, "trend": "uptrend|sideways|downtrend" },
  "risks": ["거짓 돌파 가능성", "거래량 감소"] (1-5개),
  "modelUsed": "claude" | "codex" | "gemini"
}`,
});
