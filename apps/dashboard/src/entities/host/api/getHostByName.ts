import "server-only";
import { db } from "@/shared/lib/db/client";
import { hosts } from "@/shared/lib/db/schema";
import { eq } from "drizzle-orm";
import type { Host } from "../model/types";

export async function getHostByName(name: string): Promise<Host | null> {
  const rows = await db.select().from(hosts).where(eq(hosts.name, name)).limit(1);
  return rows[0] ?? null;
}
