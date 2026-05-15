// 서버 전용 export 가 섞일 때를 대비해 barrel 은 타입 + Zod-friendly 상수만.
// UI 컴포넌트는 깊은 경로로 직접 import 한다 (Gotcha #1).
//   import { TigerNarrative } from "@/entities/tiger-reading/ui/TigerNarrative";
//
// 추후 UI 컴포넌트 추가 시에도 barrel 에 넣지 말 것.
export * from "./model/types";
export * from "./model/playmcp-response";
