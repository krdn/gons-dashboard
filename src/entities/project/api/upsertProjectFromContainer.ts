import "server-only";
import { db } from "@/shared/lib/db/client";
import { projects } from "@/shared/lib/db/schema";
import { sql } from "drizzle-orm";
import type { Project } from "../model/types";

export type UpsertInput = {
  hostId: string;
  hostName: string;
  composeProject: string;
};

// 처음 보는 compose project 를 자동 등록한다.
// 화이트리스트 게이트는 폐지됨 (사용자 결정: 운영에 서비스가 등록되면 자동 표시).
// displayName 은 compose key 그대로 — 한글 메타는 seed-projects.ts 가 채울 수 있고
// UI/DB 에서도 편집 가능. onConflictDoUpdate 는 updatedAt 만 갱신해서
// seed 가 채운 메타를 덮어쓰지 않는다.
export async function upsertProjectFromContainer(
  input: UpsertInput,
): Promise<Project | null> {
  const [row] = await db
    .insert(projects)
    .values({
      hostId: input.hostId,
      composeProject: input.composeProject,
      displayName: input.composeProject,
    })
    .onConflictDoUpdate({
      target: [projects.hostId, projects.composeProject],
      set: { updatedAt: sql`now()` },
    })
    .returning();
  return row;
}
