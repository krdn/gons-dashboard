// scripts/autopilot/cycle.workflow.js
// Workflow 도구로 실행되는 autopilot 주간 사이클.
// 호출: Workflow({ scriptPath: "scripts/autopilot/cycle.workflow.js", args: { mode, isoWeek, nowIso } })
//
// args = { mode: "shadow" | "autonomous", isoWeek: "2026-W23", nowIso: "2026-06-02T09:00:00+09:00" }

export const meta = {
  name: "autopilot-cycle",
  description: "주간 자율 업그레이드: 5인 전문가 리서치→토론→최상위 1건 선정→구현→PR",
  phases: [
    { title: "Research" },
    { title: "CrossReview" },
    { title: "Judge" },
    { title: "Implement" },
    { title: "PR" },
  ],
};

import { CANDIDATE_LIST_SCHEMA, CROSS_REVIEW_SCHEMA, VERDICT_SCHEMA } from "./schemas.js";
import { matchesProtectedPath } from "./protected-paths.js";
import { computeScore } from "./score.js";

const EXPERTS = [
  { key: "dependency-security", agentType: "security-reviewer" },
  { key: "code-architect", agentType: "code-architect" },
  { key: "product-strategist", agentType: "planner" },
  { key: "trend-researcher", agentType: "researcher" },
  { key: "ux-designer", agentType: "general-purpose" },
];

const mode = args?.mode ?? "shadow";
const isoWeek = args?.isoWeek ?? "unknown-week";

// --- 라운드 1: 제안 (병렬 fan-out) ---
phase("Research");
log(`autopilot ${isoWeek} (${mode}) — 5인 전문가 리서치 시작`);

const proposals = await parallel(
  EXPERTS.map((e) => async () => {
    const promptFile = `scripts/autopilot/experts/${e.key}.md`;
    const result = await agent(
      `다음 전문가 지시를 따라 후보를 제안하라. 지시 파일: ${promptFile}\n` +
        `먼저 그 파일을 Read 로 읽고, 절차대로 리서치한 뒤 스키마 형식으로 반환하라.`,
      { label: `research:${e.key}`, phase: "Research", agentType: e.agentType, schema: CANDIDATE_LIST_SCHEMA },
    );
    return (result?.candidates ?? []).map((c) => ({ ...c, owner: e.key }));
  }),
);

const allCandidates = proposals.filter(Boolean).flat();
log(`후보 ${allCandidates.length}건 수집`);
if (allCandidates.length === 0) {
  return { isoWeek, mode, selected: null, reason: "no-candidates", candidates: [] };
}

// touchedPaths 기반으로 protectedPathTouch 재확정 (전문가 자가신고를 코드로 검증)
for (const c of allCandidates) {
  if (matchesProtectedPath(c.touchedPaths ?? [])) c.protectedPathTouch = true;
}

// --- 라운드 2: 상호 비판 ---
phase("CrossReview");
const reviewed = await pipeline(
  allCandidates,
  async (candidate, _orig, idx) => {
    const reviewers = EXPERTS.filter((e) => e.key !== candidate.owner);
    const reviews = await parallel(
      reviewers.map((r) => async () =>
        agent(
          `너는 '${r.key}' 관점의 전문가다. 아래 업그레이드 후보를 네 영역 관점에서 비판하라.\n\n` +
            `제목: ${candidate.title}\n근거: ${candidate.rationale}\n` +
            `변경유형: ${candidate.changeType} / 예상경로: ${(candidate.touchedPaths ?? []).join(", ")}\n\n` +
            `약점·위험을 찾아 스키마 형식으로 반환하라.`,
          { label: `review:${idx}:${r.key}`, phase: "CrossReview", agentType: r.agentType, schema: CROSS_REVIEW_SCHEMA },
        ),
      ),
    );
    return { ...candidate, crossReview: reviews.filter(Boolean) };
  },
);

// --- 라운드 3: judge 패널 채점 ---
phase("Judge");
const LENSES = ["가치(value)", "안전(safety)", "실현성(feasibility)"];
const judged = await pipeline(
  reviewed,
  async (candidate, _orig, idx) => {
    const reviewSummary = (candidate.crossReview ?? [])
      .map((r) => `- [${r.severity}${r.wouldBlock ? "/BLOCK" : ""}] ${r.challenge}`)
      .join("\n");
    const verdicts = await parallel(
      LENSES.map((lens) => async () =>
        agent(
          `너는 '${lens}' 렌즈의 독립 심사위원이다. 아래 후보를 채점하라.\n\n` +
            `제목: ${candidate.title}\n근거: ${candidate.rationale}\n` +
            `impact=${candidate.impact} effort=${candidate.effort} risk=${candidate.risk}\n` +
            `보호경로건드림=${candidate.protectedPathTouch} DB마이그레이션=${candidate.dbMigration}\n\n` +
            `타 전문가 비판:\n${reviewSummary || "(없음)"}\n\n` +
            `valueScore/safetyScore/feasibilityScore (1-5) 와 reasoning 을 반환하라.`,
          { label: `judge:${idx}:${lens}`, phase: "Judge", agentType: "general-purpose", schema: VERDICT_SCHEMA },
        ),
      ),
    );
    const verdictList = verdicts.filter(Boolean);
    return { ...candidate, verdicts: verdictList, score: computeScore(candidate, verdictList) };
  },
);

// 최상위 1건 선정
const ranked = judged.filter(Boolean).sort((a, b) => b.score - a.score);
const selected = ranked[0] ?? null;
const backlog = ranked.slice(1);

log(`선정: ${selected ? `${selected.title} (score=${selected.score.toFixed(2)})` : "없음"}`);

// 선정 결과 로그 골격 (shadow/autonomous 공통)
const nowIso = args?.nowIso ?? "unknown-time";

// 토론 디테일을 사람 검수용으로 보존 (shadow 모드의 존재 이유).
// Workflow 는 파일시스템 접근 불가 — 영속화는 호출자가 이 반환값을 받아 한다.
function debate(c) {
  return {
    title: c.title,
    owner: c.owner,
    score: c.score,
    changeType: c.changeType,
    dedupKey: c.dedupKey,
    crossReview: (c.crossReview ?? []).map((r) => ({
      challenge: r.challenge,
      severity: r.severity,
      wouldBlock: r.wouldBlock,
    })),
    verdicts: (c.verdicts ?? []).map((v) => ({
      valueScore: v.valueScore,
      safetyScore: v.safetyScore,
      feasibilityScore: v.feasibilityScore,
      reasoning: v.reasoning,
    })),
  };
}

const logEntry = {
  id: `autopilot-${isoWeek}`,
  date: nowIso,
  mode,
  candidateCount: allCandidates.length,
  selected: selected
    ? { title: selected.title, owner: selected.owner, score: selected.score, changeType: selected.changeType }
    : null,
  // 사람 검수용 전체 토론 로그 (선정 1건 + backlog top3 의 비판·평결·근거).
  debate: {
    selected: selected ? debate(selected) : null,
    backlogTop3: backlog.slice(0, 3).map(debate),
  },
  backlogTop3: backlog.slice(0, 3).map((b) => ({ title: b.title, score: b.score, dedupKey: b.dedupKey })),
};

if (!selected) {
  return { ...logEntry, prUrl: null, reason: "no-candidate-selected" };
}

// 보호경로/DB마이그레이션 후보는 PR 만 만들고 needs-human (무인 머지 금지)
const needsHuman = selected.protectedPathTouch || selected.dbMigration;
const slug =
  (selected.dedupKey ?? "").replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 40) || "candidate";
const branch = `autopilot/${isoWeek}-${slug}`;

// --- 구현 페이즈 ---
phase("Implement");
const implResult = await agent(
  `너는 구현 엔지니어다. 다음 업그레이드를 gons-dashboard 에 구현하라.\n\n` +
    `제목: ${selected.title}\n근거: ${selected.rationale}\n예상경로: ${(selected.touchedPaths ?? []).join(", ")}\n\n` +
    `규칙:\n` +
    `1. 새 브랜치 '${branch}' 를 최신 main 에서 생성 (git fetch origin main; git checkout -b ${branch} origin/main)\n` +
    `2. TDD: 가능하면 테스트 먼저. CLAUDE.md 의 FSD·Gotcha 규칙 준수.\n` +
    `3. 게이트 필수 통과: pnpm typecheck && pnpm lint && (cd apps/dashboard && pnpm build)\n` +
    `4. 게이트 실패 시 최대 2회 자가수정. 그래도 실패면 gateGreen=false 로 반환하고 push 하지 마라.\n` +
    `5. 성공 시 git push -u origin ${branch}.\n\n` +
    `결과를 JSON 으로 반환하라.`,
  {
    label: `implement:${slug}`,
    phase: "Implement",
    agentType: "coder",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["gateGreen", "pushed", "summary", "filesChanged"],
      properties: {
        gateGreen: { type: "boolean" },
        pushed: { type: "boolean" },
        summary: { type: "string" },
        filesChanged: { type: "array", items: { type: "string" } },
      },
    },
  },
);

if (!implResult?.gateGreen || !implResult?.pushed) {
  return { ...logEntry, prUrl: null, reason: "implementation-gate-failed", impl: implResult };
}

// 실제 변경 파일로 보호경로 최종 재확인 (구현이 예상 밖 파일을 건드렸을 수 있음)
const actuallyProtected = matchesProtectedPath(implResult.filesChanged ?? []);
const finalNeedsHuman = needsHuman || actuallyProtected;

// --- PR 생성 (+ shadow 면 머지 안 함) ---
phase("PR");
const prInstruction =
  finalNeedsHuman
    ? `이 PR 은 보호경로/DB마이그레이션을 건드리므로 'needs-human' 라벨을 붙이고 머지하지 마라.`
    : mode === "autonomous"
      ? `머지 전 두 가지를 모두 확인하라:\n` +
        `  (a) 충돌: 'gh pr view --json mergeable' 가 MERGEABLE 인지.\n` +
        `  (b) CI green: 'gh pr checks <PR번호> --watch' 로 모든 체크(lint-typecheck + 실 Postgres 대상 테스트 포함)가 통과하는지. 통합 테스트는 CI 의 postgres service 에서만 돈다 — 여기서 회귀를 잡는다.\n` +
        `두 조건 모두 충족이면 'gh pr merge --squash --delete-branch' 로 머지하라.\n` +
        `충돌이거나 CI 체크가 하나라도 실패/대기면 'needs-human' 라벨만 붙이고 머지 보류하라.`
      : `shadow 모드다. 머지하지 말고 PR 만 생성하라.`;

const prResult = await agent(
  `브랜치 '${branch}' 로 PR 을 생성하라 (gh pr create, base=main).\n` +
    `제목: "autopilot(${isoWeek}): ${selected.title}"\n` +
    `본문에 근거·변경요약(${implResult.summary})·자동생성 표기.\n` +
    `${prInstruction}\n` +
    `결과를 JSON 으로 반환하라.`,
  {
    label: `pr:${slug}`,
    phase: "PR",
    agentType: "general-purpose",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["prUrl", "merged", "label"],
      properties: {
        prUrl: { type: "string" },
        merged: { type: "boolean" },
        label: { type: "string" },
      },
    },
  },
);

return {
  ...logEntry,
  branch,
  prUrl: prResult?.prUrl ?? null,
  merged: prResult?.merged ?? false,
  needsHuman: finalNeedsHuman,
  impl: { summary: implResult.summary, filesChanged: implResult.filesChanged },
};
