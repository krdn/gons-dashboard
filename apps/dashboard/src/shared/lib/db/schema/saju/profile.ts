// 사주 프로필 — entities/fortune-profile · widgets/fortune (다인 지원)
// - 본인·가족·지인 등 여러 사람의 사주 정보를 보관, FortuneCard 셀렉터의 소스.
// - 한자 이름은 추후 성명학 분석 확장을 위해 미리 컬럼 확보.
// - birthDate를 date 타입 대신 text("YYYY-MM-DD")로 둔 이유: 음력 입력 시
//   timezone/달력 변환 혼선을 피하고 PlayMCP에 원문 그대로 넘기기 위함.
// 사주 chart/tri 도메인 테이블의 FK 대상.
import {
  pgTable,
  text,
  timestamp,
  uuid,
  index,
  boolean,
  numeric,
} from "drizzle-orm/pg-core";
import { users } from "../auth";

export const fortuneProfiles = pgTable(
  "fortune_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameHanja: text("name_hanja"),
    // 'self' | 'spouse' | 'child' | 'parent' | 'sibling' | 'relative' | 'friend' | 'other'
    relation: text("relation").notNull(),
    birthDate: text("birth_date").notNull(), // 'YYYY-MM-DD' (입력값 그대로)
    calendar: text("calendar").notNull().default("solar"), // 'solar' | 'lunar'
    gender: text("gender").notNull(), // 'male' | 'female'
    birthTime: text("birth_time"), // 'HH:MM'
    longitudeDeg: numeric("longitude_deg", { precision: 7, scale: 4 }),
    birthCity: text("birth_city"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("fortune_profiles_user_idx").on(t.userId)],
);
