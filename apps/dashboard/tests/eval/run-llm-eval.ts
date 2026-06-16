// Layer 2 — 실제 Haiku 호출 정확도 리포트. on-prem 전용 (cli-proxy 내부망).
// 실행: pnpm eval:llm. PR 차단 X — 리포트만 (spec 2026-06-17 §6.2).
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { classifyWithLLM } from "@/shared/lib/llm/classify-thread";
import { classifyImportantWithLlm } from "@/shared/lib/llm/classify-important";
import { classifyDeterministic } from "@/entities/email/lib/deterministic-classifier";
import type { ThreadInput } from "@/entities/email/model/types";
import { binaryMetrics, macroF1, accuracy } from "./scorer";
import {
  ReplyFixtureArraySchema,
  ImportantFixtureArraySchema,
  ThresholdsSchema,
  type ReplyFixture,
} from "./types";

const DIR = __dirname;
const load = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf-8"));

// fixture input → ThreadInput (deterministic prefilter용; receivedAt·threadId는 로직 무관).
function toThreadInput(f: ReplyFixture): ThreadInput {
  return {
    threadId: f.id,
    lastSenderEmail: f.input.lastSenderEmail,
    lastSenderName: f.input.lastSenderName,
    subject: f.input.subject,
    snippet: f.input.snippet,
    receivedAt: new Date("2026-06-17T00:00:00Z"),
    ownerEmail: f.input.ownerEmail,
    lastSenderIsOwner: f.input.lastSenderIsOwner,
  };
}

async function main() {
  const replyFx = ReplyFixtureArraySchema.parse(load("fixtures/reply-needed.json"));
  const importantFx = ImportantFixtureArraySchema.parse(load("fixtures/important.json"));
  const thresholds = ThresholdsSchema.parse(load("thresholds.json"));

  let skipped = 0;

  // ── 답장 트랙 (full pipeline: deterministic prefilter → LLM) ────
  // spec §3: "deterministic가 null이면 행 삭제 + LLM 미호출". production을 그대로 미러 —
  // deterministic-null(B 암시적 케이스)은 LLM 안 부르고 곧장 no-reply 처리해야 recall이
  // 파이프라인 실제 동작을 반영(LLM-standalone이면 B를 LLM이 잡아 recall 과대평가).
  const replyCases: { predicted: boolean; expected: boolean }[] = [];
  for (const f of replyFx) {
    if (classifyDeterministic(toThreadInput(f)) === null) {
      replyCases.push({ predicted: false, expected: f.expect.needsReply });
      continue; // LLM 미호출 — production이 버린 메일
    }
    try {
      const r = await classifyWithLLM({
        fromEmail: f.input.lastSenderEmail,
        fromName: f.input.lastSenderName,
        subject: f.input.subject,
        snippet: f.input.snippet,
      });
      if (r.kind === "llm-unavailable") {
        console.error(`[eval] LLM unavailable: ${r.error}`);
        skipped++;
        continue;
      }
      replyCases.push({
        predicted: r.kind === "needs-reply",
        expected: f.expect.needsReply,
      });
    } catch (err) {
      console.error(`[eval] reply ${f.id} 실패:`, err instanceof Error ? err.message : err);
      skipped++;
    }
  }
  const replyM = binaryMetrics(replyCases);

  // ── 중요 트랙 (full pipeline: LLM, mailing-list 컷 통과한 것만) ──
  const catCases: { predicted: string; expected: string }[] = [];
  const impCases: { predicted: string; expected: string }[] = [];
  for (const f of importantFx) {
    if (f.expect.isMailingList) continue; // 컷 대상은 LLM 안 감
    try {
      const r = await classifyImportantWithLlm(f.input);
      const predictedCat = r === null ? "none" : r.category;
      catCases.push({ predicted: predictedCat, expected: f.expect.category ?? "none" });
      if (r !== null && f.expect.importance) {
        impCases.push({ predicted: r.importance, expected: f.expect.importance });
      }
    } catch (err) {
      console.error(`[eval] important ${f.id} 실패:`, err instanceof Error ? err.message : err);
      skipped++;
    }
  }
  const catF1 = macroF1(catCases, ["money", "security", "schedule", "notice", "none"]);
  const impAcc = accuracy(impCases);

  // ── 리포트 ──────────────────────────────────────────────────────
  const report = {
    generatedAt: new Date().toISOString(),
    skipped,
    reply: {
      precision: replyM.precision, recall: replyM.recall, f1: replyM.f1,
      tp: replyM.tp, fp: replyM.fp, fn: replyM.fn,
    },
    important: { categoryMacroF1: catF1, importanceAccuracy: impAcc, n: catCases.length },
  };

  const gate = (val: number, th: number | null) =>
    th === null ? "TBD" : val >= th ? "PASS" : "WARN";

  console.log("\n=== Email Classification Eval (Layer 2, Haiku) ===");
  console.log(`평가 불가(skip): ${skipped}건`);
  console.log(`\n[답장] precision=${replyM.precision.toFixed(3)} recall=${replyM.recall.toFixed(3)} f1=${replyM.f1.toFixed(3)}`);
  console.log(`  precision gate: ${gate(replyM.precision, thresholds.replyLlm.precision)}`);
  console.log(`  recall gate: ${gate(replyM.recall, thresholds.replyLlm.recall)}`);
  console.log(`\n[중요] categoryMacroF1=${catF1.toFixed(3)} importanceAccuracy=${impAcc.toFixed(3)}`);
  console.log(`  category gate: ${gate(catF1, thresholds.importantLlm.categoryMacroF1)}`);
  console.log(`  importance gate: ${gate(impAcc, thresholds.importantLlm.importanceAccuracy)}`);

  const outDir = join(DIR, "reports");
  mkdirSync(outDir, { recursive: true });
  const stamp = report.generatedAt.slice(0, 10);
  const outPath = join(outDir, `${stamp}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\n리포트 저장: ${outPath}`);
}

main().catch((err) => {
  console.error("[eval] 치명적 실패:", err);
  process.exit(1);
});
