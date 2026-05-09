// Vitest setup — Next.js의 server-only 가드를 우회 + .env 로딩.
// 테스트 환경에서는 server-only를 빈 모듈로 대체하고,
// DB 등 실제 인프라를 사용하는 테스트를 위해 .env를 로드한다.
import "dotenv/config";
import { vi } from "vitest";

vi.mock("server-only", () => ({}));
