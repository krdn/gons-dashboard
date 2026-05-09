// Vitest setup — Next.js의 server-only 가드를 우회.
// 테스트 환경에서는 빈 모듈로 대체.
import { vi } from "vitest";

vi.mock("server-only", () => ({}));
