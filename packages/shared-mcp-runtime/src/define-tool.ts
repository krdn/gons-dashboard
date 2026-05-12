import type { z } from "zod";

export interface ToolDefinition<I, O> {
  name: string;
  description: string;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  handler: (input: I) => Promise<O>;
}

export interface DefineToolOptions<I, O> {
  name: string;
  description: string;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  handler: (input: I) => Promise<O>;
}

export function defineTool<I, O>(
  opts: DefineToolOptions<I, O>,
): ToolDefinition<I, O> {
  const handler = async (rawInput: I): Promise<O> => {
    const inputParsed = opts.input.safeParse(rawInput);
    if (!inputParsed.success) {
      throw new Error(`Invalid input for tool ${opts.name}: ${inputParsed.error.message}`);
    }
    const result = await opts.handler(inputParsed.data);
    const outputParsed = opts.output.safeParse(result);
    if (!outputParsed.success) {
      throw new Error(`Invalid output from tool ${opts.name}: ${outputParsed.error.message}`);
    }
    return outputParsed.data;
  };
  return {
    name: opts.name,
    description: opts.description,
    input: opts.input,
    output: opts.output,
    handler,
  };
}
