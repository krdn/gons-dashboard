// features/memo-compose — client-safe entrypoint. Server Action만 re-export.
// server-only 함수(cleanup-transcript, memoRepo)가 client 번들로 새지 않게 분리 (Gotcha #7).
export { cleanupTranscriptAction } from "./api/cleanupTranscriptAction";
// 타입은 원 선언지에서 — "use server" 파일 경유 재-export는 런타임 ReferenceError (위 파일 주석 참조).
// `export type ... from` 은 컴파일 시 구문째 지워지므로 server-only 모듈이 client 번들로 새지 않는다.
export type { CleanupResult } from "./lib/cleanup-transcript";
export { createMemoAction } from "./api/createMemoAction";
export type { CreateMemoInputAction, CreateMemoActionResult } from "./api/createMemoAction";
