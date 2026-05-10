import "server-only";
import { db } from "@/shared/lib/db/client";
import { hosts } from "@/shared/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import type { Host } from "../model/types";

export async function getHosts(): Promise<Host[]> {
  return db
    .select()
    .from(hosts)
    .where(eq(hosts.isActive, true))
    .orderBy(asc(hosts.name));
}
