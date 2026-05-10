"use server";
import { runAction, type ActionInputT, type ActionResult } from "./_runAction";

export async function restartContainer(
  input: ActionInputT,
): Promise<ActionResult> {
  return runAction("restart", input);
}
