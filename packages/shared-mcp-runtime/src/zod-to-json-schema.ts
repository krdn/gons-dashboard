// Minimal Zod → JSON Schema 변환. zod-to-json-schema npm 패키지를 끌어오지 않고
// MCP가 요구하는 최소 형태만 제공한다.
//
// 지원: ZodObject (중첩 포함), array, string, number, integer, boolean,
//       optional, default, effects(.refine/.transform — inner 스키마로 unwrap).
// 더 복잡한 스키마(union, record 등)가 필요해지면 zod-to-json-schema 패키지로 교체.
import { z } from "zod";

type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
};

export function zodToJsonSchema(schema: z.ZodType): JsonSchema {
  const base = unwrap(schema);
  if (!(base instanceof z.ZodObject)) {
    throw new Error("zodToJsonSchema currently supports only ZodObject at top level");
  }
  return objectSchema(base);
}

function objectSchema(obj: z.ZodObject<z.ZodRawShape>): JsonSchema {
  const shape = obj.shape as Record<string, z.ZodTypeAny>;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, field] of Object.entries(shape)) {
    const unwrapped = unwrap(field);
    properties[key] = fieldSchema(unwrapped);
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
  // .refine()/.transform() 은 ZodEffects 로 감싸인다 — JSON Schema 로는 표현
  // 불가한 제약이므로 inner 스키마만 광고하고, 실제 검증은 호출 시 Zod 가 수행.
  if (field instanceof z.ZodEffects) return unwrap(field._def.schema);
  return field;
}

function isOptionalOrDefault(field: z.ZodTypeAny): boolean {
  return field instanceof z.ZodOptional || field instanceof z.ZodDefault;
}

function fieldSchema(field: z.ZodTypeAny): Record<string, unknown> {
  if (field instanceof z.ZodString) return { type: "string" };
  if (field instanceof z.ZodNumber) {
    return field._def.checks?.some((c: { kind?: string }) => c.kind === "int")
      ? { type: "integer" }
      : { type: "number" };
  }
  if (field instanceof z.ZodBoolean) return { type: "boolean" };
  if (field instanceof z.ZodArray) {
    return { type: "array", items: fieldSchema(unwrap(field._def.type)) };
  }
  if (field instanceof z.ZodObject) return objectSchema(field);
  return { type: "string" }; // 알 수 없는 타입은 string으로 — MCP 서버 자체는 입력 시점에 다시 Zod로 검증.
}
