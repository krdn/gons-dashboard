import "server-only";
import { db } from "@/shared/lib/db/client";
import { projects } from "@/shared/lib/db/schema";
import { sql } from "drizzle-orm";
import { isKnownComposeProject } from "./isKnownComposeProject";
import type { Project } from "../model/types";

export type UpsertInput = {
  hostId: string;
  hostName: string;
  composeProject: string;
};

export async function upsertProjectFromContainer(
  input: UpsertInput,
): Promise<Project | null> {
  if (!isKnownComposeProject(input.hostName, input.composeProject)) {
    // 화이트리스트 외 compose는 standalone 그룹으로 합류 (Task 6에서 처리)
    return null;
  }

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
