// Minimal Zod → JSON Schema 변환. zod-to-json-schema npm 패키지를 끌어오지 않고
// MCP가 요구하는 최소 형태만 제공한다.
//
// 지원: ZodObject 1단계 (string, number, integer, boolean, optional, default).
// 더 복잡한 스키마(중첩, union, array)가 필요해지면 zod-to-json-schema 패키지로 교체.
import { z } from "zod";

type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
};

export function zodToJsonSchema(schema: z.ZodType): JsonSchema {
  if (!(schema instanceof z.ZodObject)) {
    throw new Error("zodToJsonSchema currently supports only ZodObject at top level");
  }
  const shape = schema.shape as Record<string, z.ZodTypeAny>;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, field] of Object.entries(shape)) {
    const unwrapped = unwrap(field);
    properties[key] = primitiveSchema(unwrapped);
    if (!isOptionalOrDefault(field)) {
      required.push(key);
    }
  }

  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function unwrap(field: z.ZodTypeAny): z.ZodTypeAny {
  if (field instanceof z.ZodOptional) return unwrap(field._def.innerType);
  if (field instanceof z.ZodDefault) return unwrap(field._def.innerType);
  return field;
}

function isOptionalOrDefault(field: z.ZodTypeAny): boolean {
  return field instanceof z.ZodOptional || field instanceof z.ZodDefault;
}

function primitiveSchema(field: z.ZodTypeAny): Record<string, unknown> {
  if (field instanceof z.ZodString) return { type: "string" };
  if (field instanceof z.ZodNumber) {
    return field._def.checks?.some((c: { kind?: string }) => c.kind === "int")
      ? { type: "integer" }
      : { type: "number" };
  }
  if (field instanceof z.ZodBoolean) return { type: "boolean" };
  return { type: "string" }; // 알 수 없는 타입은 string으로 — MCP 서버 자체는 입력 시점에 다시 Zod로 검증.
}
