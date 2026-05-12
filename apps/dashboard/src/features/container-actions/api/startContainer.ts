"use server";
import { runAction, type ActionInputT, type ActionResult } from "./_runAction";

export async function startContainer(
  input: ActionInputT,
): Promise<ActionResult> {
  return runAction("start", input);
}
