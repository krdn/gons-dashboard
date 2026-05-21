-- stock_consensus_flips 의 24h dedup 용 generated column + unique index.
-- timestamptz::date 는 IMMUTABLE 이 아니라 expression index 가 거부되므로
-- KST 자정 기준 date 를 STORED generated column 으로 미리 산출해 두고
-- 그 컬럼에 unique index 를 건다. detected_at AT TIME ZONE 'Asia/Seoul' 은 IMMUTABLE.

ALTER TABLE "stock_consensus_flips"
  ADD COLUMN "detected_date" date
    GENERATED ALWAYS AS (((detected_at AT TIME ZONE 'Asia/Seoul')::date)) STORED;
--> statement-breakpoint
CREATE UNIQUE INDEX "flips_dedup_uq" ON "stock_consensus_flips" USING btree ("user_id","symbol","detected_date");
