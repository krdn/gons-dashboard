export const RELATIONS = [
  "self",
  "spouse",
  "child",
  "parent",
  "sibling",
  "relative",
  "friend",
  "other",
] as const;
export type Relation = (typeof RELATIONS)[number];

export type Gender = "male" | "female";
export type Calendar = "solar" | "lunar";

export type FortuneProfile = {
  id: string;
  userId: string;
  name: string;
  nameHanja: string | null;
  relation: Relation;
  birthDate: string; // 'YYYY-MM-DD'
  calendar: Calendar;
  gender: Gender;
  birthTime: string | null; // 'HH:MM'
  birthCity: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export const RELATION_LABEL: Record<Relation, string> = {
  self: "본인",
  spouse: "배우자",
  child: "자녀",
  parent: "부모",
  sibling: "형제자매",
  relative: "친척",
  friend: "친구",
  other: "기타",
};
