import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool } from "./define-tool";

describe("defineTool", () => {
  it("returns a tool object with name, description, schema, handler", () => {
    const tool = defineTool({
      name: "calendar.getUpcomingEvents",
      description: "List upcoming events",
      input: z.object({ withinHours: z.number() }),
      output: z.object({ count: z.number() }),
      handler: async ({ withinHours }) => ({ count: withinHours }),
    });
    expect(tool.name).toBe("calendar.getUpcomingEvents");
    expect(tool.description).toBe("List upcoming events");
    expect(typeof tool.handler).toBe("function");
    expect(tool.input).toBeDefined();
    expect(tool.output).toBeDefined();
  });

  it("handler validates input via Zod", async () => {
    const tool = defineTool({
      name: "echo",
      description: "echo",
      input: z.object({ msg: z.string() }),
      output: z.object({ msg: z.string() }),
      handler: async (input) => input,
    });
    await expect(tool.handler({ msg: 123 } as never)).rejects.toThrow();
  });

  it("handler validates output via Zod", async () => {
    const tool = defineTool({
      name: "broken",
      description: "broken",
      input: z.object({}),
      output: z.object({ count: z.number() }),
      handler: async () => ({ count: "not a number" }) as never,
    });
    await expect(tool.handler({})).rejects.toThrow();
  });
});
