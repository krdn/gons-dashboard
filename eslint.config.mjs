import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import boundaries from "eslint-plugin-boundaries";

// FSD (Feature-Sliced Design) 의존성 방향 강제
// 허용: app → widgets → features → entities → shared
// 같은 레이어 내 슬라이스끼리는 직접 import 불가 (entities는 entities를, features는 features를)
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
          { from: "widgets", allow: ["features", "entities", "shared"] },
          { from: "features", allow: ["entities", "shared"] },
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
