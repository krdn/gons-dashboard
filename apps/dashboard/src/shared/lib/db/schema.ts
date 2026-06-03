// Drizzle 스키마 진입점 — 도메인별 파일로 분리됨 (schema/<domain>.ts).
//
// 이 파일은 무중단 호환 barrel: drizzle.config.ts 의 schema 경로와 모든 src
// import("@/shared/lib/db/schema") 가 그대로 동작하도록 schema/index.ts 를 재export.
//
// ⚠️ 반드시 "./schema/index" (명시 /index) 로 import — bare "./schema" 는 이 파일
// 자신을 가리켜 순환 self-import 가 되어 export 가 전부 undefined 가 된다.
export * from "./schema/index";
