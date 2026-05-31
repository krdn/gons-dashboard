// tickerlens end-to-end 스모크 테스트 — Yahoo 데이터레이어 + LLM 12셀(페르소나4×타임프레임3) 검증.
// 실행: cd apps/dashboard && node --env-file=.env src/scripts/verify-final.mjs [TICKER]
// 판정: completed>=9 면 GREEN. 429(rate limit)는 실패 아님 — 스크립트가 구분 출력.
// provider는 features/stock-timeframe-analyze/lib/tickerlens-adapter.ts 와 동일하게 "claude-cli" 유지.
// ("anthropic"이면 gateway callMethod:"direct"→/messages(=/v1 누락)→404. 회귀 방지용 기준 스크립트.)
import { composeTickerAnalysis } from "@krdn/tickerlens";
const cfg = { async resolve() {
  // 폴백값은 shared/config/env.ts 의 SAJU_LLM_MODEL_CLAUDE default 와 일치 유지 (드리프트 방지)
  return { provider:"claude-cli", model: process.env.SAJU_LLM_MODEL_CLAUDE ?? "claude-opus-4-7",
    apiKey: process.env.ANTHROPIC_API_KEY, baseUrl: process.env.ANTHROPIC_BASE_URL };
}};
const PERSONAS=["value","growth","quant","options"], TIMEFRAMES=["long","mid","short"];
const ticker = process.argv[2] ?? "AAPL";
console.log(`[final] composeTickerAnalysis(${ticker}, lite)…`);
try {
  const r = await composeTickerAnalysis(ticker, { configAdapter: cfg, depth: "lite" });
  console.log("[final] meta:", JSON.stringify(r.meta));
  console.log("[final] price.last:", r.snapshot.price.last, "| marketCap:", r.snapshot.fundamentals.marketCap, "| PER:", r.snapshot.fundamentals.pe);
  let ok=0, notOk=0; const cells=[];
  for (const p of PERSONAS) for (const tf of TIMEFRAMES) {
    const s=r.perspectives[p][tf];
    if(s.ok){ok++;cells.push(`${p}/${tf}=${s.value.signal}`);} else {notOk++;cells.push(`${p}/${tf}=✗${s.error.code}`);}
  }
  console.log(`[final] 12셀 ok=${ok} not-ok=${notOk}`);
  console.log("[final] " + cells.join(" | "));
  console.log(r.meta.completed>=9 ? `[final] ✅✅ GREEN (completed=${r.meta.completed})` : `[final] ⚠️ completed=${r.meta.completed} (<9)`);
} catch(e){
  const m=e?.cause?.message??e?.message??"";
  console.log(m.includes("Too Many Requests")||m.includes("429") ? "[final] ⏳ 아직 429 (rate limit 미회복)" : "[final] ❌ "+m);
  process.exit(m.includes("429")?2:1);
}
