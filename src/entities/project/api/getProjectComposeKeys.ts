import "server-only";
import { db } from "@/shared/lib/db/client";
import { projects } from "@/shared/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * 호스트의 모든 compose project key를 반환 (hidden 포함).
 * `getHostsWithSummary`의 lazy upsert 중복 방지용 — hidden project가 매번
 * unknown으로 분류돼 onConflictDoUpdate가 트리거되는 것을 막는다.
 */
export async function getProjectComposeKeys(hostId: string): Promise<string[]> {
  const rows = await db
    .select({ composeProject: projects.composeProject })
    .from(projects)
    .where(eq(projects.hostId, hostId));
  return rows.map((r) => r.composeProject);
}
