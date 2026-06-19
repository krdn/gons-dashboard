// tiger-reading 엔티티의 public surface.
// server-only export 가 없어(타입은 import type 으로 erase) 단일 barrel 로 충분 —
// 타입·상수·표현 컴포넌트를 한 진입점에서 노출한다.
export * from "./model/types";
export * from "./model/playmcp-response";
export { TigerNarrative } from "./ui/TigerNarrative";
export { TigerErrorPanel } from "./ui/TigerErrorPanel";
