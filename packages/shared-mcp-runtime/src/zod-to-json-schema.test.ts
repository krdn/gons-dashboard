import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodToJsonSchema } from "./zod-to-json-schema";

describe("zodToJsonSchema", () => {
  it("primitive 필드와 optional/default required 판정", () => {
    const schema = z.object({
      name: z.string(),
      count: z.number().int().default(10),
      flag: z.boolean().optional(),
    });
    expect(zodToJsonSchema(schema)).toEqual({
      type: "object",
      properties: {
        name: { type: "string" },
        count: { type: "integer" },
        flag: { type: "boolean" },
      },
      required: ["name"],
      additionalProperties: false,
    });
  });

  it("top-level .refine() (ZodEffects) 을 unwrap 한다 — calendar InputSchema 회귀", () => {
    // mcp-calendar get-upcoming-events InputSchema와 동일 형태.
    const schema = z
      .object({
        withinHours: z.number().int().min(1).max(336).default(24),
        calendarId: z.string().optional(),
        calendars: z
          .array(z.object({ id: z.string(), summary: z.string() }))
          .min(1)
          .optional(),
      })
      .refine((v) => !(v.calendarId && v.calendars), {
        message: "calendarId와 calendars는 동시 지정 불가",
      });
    const json = zodToJsonSchema(schema);
    expect(json.type).toBe("object");
    expect(json.required).toEqual([]);
    expect(json.properties.withinHours).toEqual({ type: "integer" });
  });

  it("array-of-objects 필드를 중첩 스키마로 변환한다", () => {
    const schema = z.object({
      calendars: z.array(z.object({ id: z.string(), summary: z.string() })),
    });
    expect(zodToJsonSchema(schema).properties.calendars).toEqual({
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          summary: { type: "string" },
        },
        required: ["id", "summary"],
        additionalProperties: false,
      },
    });
  });

  it("ZodObject 가 아닌 top-level 은 여전히 거부한다", () => {
    expect(() => zodToJsonSchema(z.string())).toThrow(/ZodObject/);
  });
});
