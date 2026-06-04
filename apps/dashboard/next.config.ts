import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker production 이미지를 작게 만들기 위한 standalone 출력
  output: "standalone",

  // Postgres 드라이버 (postgres) 가 server-only로 동작하도록
  serverExternalPackages: ["postgres", "tree-sitter-bash", "web-tree-sitter", "@lydell/node-pty-linux-x64", "@krdn/llm-gateway", "@krdn/tickerlens", "yahoo-finance2"],

  // workspace 패키지들은 TS 소스 그대로 import — Next.js가 직접 트랜스파일.
  transpilePackages: [
    "@gons/shared-google",
    "@gons/shared-mcp-runtime",
    "@gons/mcp-calendar",
  ],
};

export default nextConfig;
