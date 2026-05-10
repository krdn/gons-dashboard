"use server";
import { runAction, type ActionInputT, type ActionResult } from "./_runAction";

export async function stopContainer(
  input: ActionInputT,
): Promise<ActionResult> {
  return runAction("stop", input);
}
