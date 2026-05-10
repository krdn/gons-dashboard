import "server-only";
import { db } from "@/shared/lib/db/client";
import { projects } from "@/shared/lib/db/schema";
import { sql } from "drizzle-orm";
import type { Project } from "../model/types";

export type UpsertInput = {
  hostId: string;
  composeProject: string;
};

export async function upsertProjectFromContainer(
  input: UpsertInput,
): Promise<Project> {
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
