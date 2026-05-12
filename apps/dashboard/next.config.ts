import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker production 이미지를 작게 만들기 위한 standalone 출력
  output: "standalone",

  // Postgres 드라이버 (postgres) 가 server-only로 동작하도록
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
