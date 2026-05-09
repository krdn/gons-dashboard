// Health check — Docker healthcheck + GitHub Actions 배포 후 확인용.
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`SELECT 1`);
    return NextResponse.json({
      status: "ok",
      time: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : "unknown",
      },
      { status: 503 },
    );
  }
}
