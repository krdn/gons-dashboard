import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    // KST 강제 — TZ 회귀 테스트 일관성.
    env: { TZ: "Asia/Seoul" },
    // 통합 테스트들이 같은 test DB 를 공유하므로 file 병렬 실행 시 race 발생
    // (한 file 의 beforeEach 가 다른 file 의 직전 INSERT 를 cleanup → "[] expected length 1").
    // 직렬 실행으로 race 차단. 전체 suite 시간 약간 증가지만 isolation 보장.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
