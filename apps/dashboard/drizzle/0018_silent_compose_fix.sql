-- Hotfix: saju_monthly_tri_school_check 가 'compose' 누락된 버그 수정 (0016 migration 의
-- monthly_tri CHECK 가 yearly_tri 패턴을 따르지 않음). 운영의 monthly 위젯이 build → INSERT
-- 시 school='compose' 로 row 저장하려다 CHECK 위반으로 fail. drizzle-kit 미지원, 수동 append.
ALTER TABLE "saju_monthly_tri"
  DROP CONSTRAINT "saju_monthly_tri_school_check";--> statement-breakpoint
ALTER TABLE "saju_monthly_tri"
  ADD CONSTRAINT "saju_monthly_tri_school_check"
  CHECK (school IN ('ko', 'cn-ziping', 'cn-mangpai', 'jp', 'compose'));
