// DB 스키마 barrel — 도메인별 파일을 한 곳에서 re-export.
// drizzle-kit migrate 경로(drizzle.config.ts schema)와 모든 src import
// (@/shared/lib/db/schema)는 상위 ../schema.ts 재export 를 통해 무중단 유지된다.
//
// FSD: 이 디렉토리는 shared/lib/db (모든 도메인이 공유하는 인프라). 도메인별 모델
// 타입은 entities/<domain>/model/*.ts 에서 이 스키마를 import 하여 사용한다.
//
// 인덱스·제약 결정 (plan-eng-review):
//  - reply_needed_open_idx: partial index for "오픈 상태" (email)
//  - users.oauth_state: 'active' | 'reauth_required' (auth)
//  - users.last_history_id: Gmail History API incremental polling (auth)
export * from "./auth";
export * from "./email";
export * from "./infra";
export * from "./saju";
export * from "./playmcp";
export * from "./stock";
