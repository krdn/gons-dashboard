import "server-only";
import { db } from "@/shared/lib/db/client";
import { projects } from "@/shared/lib/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Project } from "../model/types";

export async function getProjects(hostId: string): Promise<Project[]> {
  return db
    .select()
    .from(projects)
    .where(and(eq(projects.hostId, hostId), eq(projects.isHidden, false)))
    .orderBy(desc(projects.isPinned), asc(projects.composeProject));
}
