import type {
  playmcpProfiles,
  playmcpAnalysis,
  playmcpYearly,
  playmcpDaily,
  playmcpCompatibility,
} from "@/shared/lib/db/schema";

export type PlaymcpProfileRow = typeof playmcpProfiles.$inferSelect;
export type PlaymcpProfileInsert = typeof playmcpProfiles.$inferInsert;
export type PlaymcpAnalysisRow = typeof playmcpAnalysis.$inferSelect;
export type PlaymcpYearlyRow = typeof playmcpYearly.$inferSelect;
export type PlaymcpDailyRow = typeof playmcpDaily.$inferSelect;
export type PlaymcpCompatibilityRow = typeof playmcpCompatibility.$inferSelect;

export const RELATION_VALUES = [
  "self",
  "spouse",
  "child",
  "parent",
  "sibling",
  "relative",
  "friend",
  "other",
] as const;
export type Relation = (typeof RELATION_VALUES)[number];

export const GENDER_VALUES = ["male", "female"] as const;
export type Gender = (typeof GENDER_VALUES)[number];

export const CALENDAR_VALUES = ["solar", "lunar"] as const;
export type Calendar = (typeof CALENDAR_VALUES)[number];
