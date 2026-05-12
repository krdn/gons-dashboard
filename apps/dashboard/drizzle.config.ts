import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL 미설정. .env 파일을 확인하세요.");
}

export default defineConfig({
  schema: "./src/shared/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  // SQL 출력에 강한 식별자 인용 — pgcrypto, AT TIME ZONE 등 안전
  strict: true,
  verbose: true,
});
