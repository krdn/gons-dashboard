import { wallStreet } from "./wallStreet";
import { krExpert } from "./krExpert";
import { value } from "./value";
import { growth } from "./growth";
import { technical } from "./technical";
import type { PromptBuilder } from "./types";
import type { PersonaKey } from "../schemas/persona";

export type { PersonaInput, BuiltPrompt, PromptBuilder } from "./types";

export const PERSONA_BUILDERS: Record<PersonaKey, PromptBuilder> = {
  wallStreet,
  krExpert,
  value,
  growth,
  technical,
};
