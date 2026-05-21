"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { stockPersonaPreferences } from "@/shared/lib/db/schema";
import {
  updatePersonaOverrides,
  type PersonaModelMapping,
} from "@/shared/lib/llm/persona-router";

const ModelNameSchema = z.enum(["claude", "codex", "gemini"]);
const PersonaOrConsensusSchema = z.enum([
  "wallStreet",
  "krExpert",
  "value",
  "growth",
  "technical",
  "consensus",
]);

const UpdateSchema = z.object({
  persona: PersonaOrConsensusSchema,
  model: ModelNameSchema,
});

export interface UpdateOverridesResult {
  success: boolean;
  error?: string;
}

export async function setPersonaModel(input: {
  persona: keyof PersonaModelMapping;
  model: "claude" | "codex" | "gemini";
}): Promise<UpdateOverridesResult> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };

  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "잘못된 입력" };

  try {
    await updatePersonaOverrides(session.user.id, {
      [parsed.data.persona]: parsed.data.model,
    } as Partial<PersonaModelMapping>);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "DB 에러",
    };
  }
}

export async function resetPersonaModels(): Promise<UpdateOverridesResult> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };
  try {
    await db
      .delete(stockPersonaPreferences)
      .where(eq(stockPersonaPreferences.userId, session.user.id));
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "DB 에러",
    };
  }
}
