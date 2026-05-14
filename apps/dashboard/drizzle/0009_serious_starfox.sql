-- 사주 캐시-리딩 모듈 deepening (spec: docs/superpowers/specs/2026-05-14-saju-cached-reading-deepening.md)
-- 세 캐시 테이블에 prompt_version 컬럼 추가.
-- ADD COLUMN DEFAULT 로 기존 행 backfill ('legacy-v0' sentinel) — 첫 조회 시 새 prompt version 과 mismatch 라 자동 재생성.
-- DROP DEFAULT 로 신규 INSERT 시 promptVersion 명시 필수 (silent stale row 방지).
ALTER TABLE "saju_daily_fortunes" ADD COLUMN "prompt_version" text DEFAULT 'legacy-v0' NOT NULL;--> statement-breakpoint
ALTER TABLE "saju_readings" ADD COLUMN "prompt_version" text DEFAULT 'legacy-v0' NOT NULL;--> statement-breakpoint
ALTER TABLE "saju_yearly_readings" ADD COLUMN "prompt_version" text DEFAULT 'legacy-v0' NOT NULL;--> statement-breakpoint
ALTER TABLE "saju_daily_fortunes" ALTER COLUMN "prompt_version" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "saju_readings" ALTER COLUMN "prompt_version" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "saju_yearly_readings" ALTER COLUMN "prompt_version" DROP DEFAULT;