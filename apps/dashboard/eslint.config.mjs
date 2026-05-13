import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import boundaries from "eslint-plugin-boundaries";

// FSD (Feature-Sliced Design) 의존성 방향 강제
// 허용: app → widgets → features → entities → shared
// 같은 레이어 내 슬라이스끼리는 원칙상 직접 import 금지지만,
// features→features는 의도적으로 허용한다.
//   이유: features/host-catalog가 features/container-list의 pure 헬퍼
//   (groupByProject)를 재사용하기 위함. 사이드이펙트 없는 fn만 노출되므로
//   "가장 작은 변경"으로 boundary를 한 단계만 풀어준다. UI/state 결합이
//   생기면 그때 다시 좁힐 것.
// widgets→widgets도 같은 원리로 허용한다.
//   이유: widgets/fortune (홈 위젯) 이 widgets/saju-detail 의 표현 컴포넌트
//   (SajuDailyFortune) 를 재사용하기 위함. 사주 일진 표시는 홈·상세 두
//   페이지에서 동일하게 쓰이는 presentational UI 라 widgets 안에서 공유한다.
const fsdConfig = {
  files: ["src/**/*.{ts,tsx}"],
  plugins: { boundaries },
  settings: {
    "boundaries/elements": [
      { type: "app", pattern: "src/app/**" },
      { type: "widgets", pattern: "src/widgets/*", mode: "folder" },
      { type: "features", pattern: "src/features/*", mode: "folder" },
      { type: "entities", pattern: "src/entities/*", mode: "folder" },
      { type: "shared", pattern: "src/shared/**" },
    ],
    "boundaries/include": ["src/**/*"],
    "import/resolver": {
      typescript: { project: "./tsconfig.json" },
    },
  },
  rules: {
    "boundaries/element-types": [
      "error",
      {
        default: "disallow",
        rules: [
          { from: "app", allow: ["widgets", "features", "entities", "shared"] },
          { from: "widgets", allow: ["widgets", "features", "entities", "shared"] },
          { from: "features", allow: ["features", "entities", "shared"] },
          { from: "entities", allow: ["shared"] },
          { from: "shared", allow: ["shared"] },
        ],
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  fsdConfig,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
