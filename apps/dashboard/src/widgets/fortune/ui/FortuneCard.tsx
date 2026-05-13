import "server-only";
import { listFortuneProfiles } from "@/entities/fortune-profile";
import { auth } from "@/shared/lib/auth";
import { FortuneCardClient } from "./FortuneCardClient";

export async function FortuneCard() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const profiles = await listFortuneProfiles(session.user.id);
  return <FortuneCardClient profiles={profiles} />;
}
