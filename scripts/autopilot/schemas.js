// scripts/autopilot/schemas.js
// autopilot 토론에서 에이전트가 반환하는 구조화 출력의 JSON Schema 정의.
// Workflow 도구의 agent(prompt, {schema}) 에 그대로 전달된다.

/** 라운드 1: 전문가가 제출하는 업그레이드 후보 */
export const CANDIDATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "rationale",
    "impact",
    "effort",
    "risk",
    "changeType",
    "protectedPathTouch",
    "dbMigration",
    "dedupKey",
    "touchedPaths",
  ],
  properties: {
    title: { type: "string", description: "한 줄 제목 (한국어)" },
    rationale: { type: "string", description: "왜 이 업그레이드가 가치 있는지" },
    impact: { type: "integer", minimum: 1, maximum: 5 },
    effort: { type: "integer", minimum: 1, maximum: 5 },
    risk: { type: "integer", minimum: 1, maximum: 5 },
    changeType: {
      type: "string",
      enum: ["deps", "security", "refactor", "feature", "ui", "perf"],
    },
    protectedPathTouch: { type: "boolean" },
    dbMigration: { type: "boolean" },
    dedupKey: {
      type: "string",
      description: "동일 후보 중복 판별용 안정 키 (예: 'deps:next-16.3')",
    },
    touchedPaths: {
      type: "array",
      items: { type: "string" },
      description: "이 후보가 수정할 것으로 예상되는 레포 상대 경로 glob 목록",
    },
  },
};

/** 전문가가 후보 N건을 한 번에 반환 */
export const CANDIDATE_LIST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      items: CANDIDATE_SCHEMA,
      maxItems: 3,
    },
  },
};

/** 라운드 2: 한 후보에 대한 타 전문가의 비판 */
export const CROSS_REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["challenge", "severity", "wouldBlock"],
  properties: {
    challenge: { type: "string", description: "이 후보의 약점·위험 (한국어)" },
    severity: { type: "string", enum: ["low", "medium", "high"] },
    wouldBlock: {
      type: "boolean",
      description: "이 후보를 이번 주에 진행하면 안 된다고 보는가",
    },
  },
};

/** 라운드 3: judge 한 명의 채점 */
export const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["valueScore", "safetyScore", "feasibilityScore", "reasoning"],
  properties: {
    valueScore: { type: "integer", minimum: 1, maximum: 5 },
    safetyScore: { type: "integer", minimum: 1, maximum: 5 },
    feasibilityScore: { type: "integer", minimum: 1, maximum: 5 },
    reasoning: { type: "string" },
  },
};
