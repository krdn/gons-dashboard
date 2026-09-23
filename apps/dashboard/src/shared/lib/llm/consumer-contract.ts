import {
  analyzeText,
  analyzeStructured,
  type AIGatewayOptions,
} from "@krdn/llm-gateway/gateway";
import { z } from "zod";
import type { ModelTier } from "./pick-latest-model";

export interface ContractCheck {
  status: "PASS" | "FAIL" | "UNKNOWN";
  scope: string;
  model: string;
  detail: string;
}

// 실제 SDK 오류를 판정하되 오류 본문/헤더(키와 사용자 데이터 가능)는 출력하지 않는다.
function failure(error: unknown): Pick<ContractCheck, "status" | "detail"> {
  let current = error;
  let outputFailure = false;
  for (let i = 0; i < 4 && current && typeof current === "object"; i++) {
    if (
      "name" in current &&
      (current.name === "AI_NoObjectGeneratedError" ||
        (current.name === "StructuredOutputError" &&
          !("cause" in current && current.cause)))
    ) {
      outputFailure = true;
    }
    if ("statusCode" in current && typeof current.statusCode === "number") {
      const code = current.statusCode;
      return {
        status: [400, 401, 403, 404].includes(code) ? "FAIL" : "UNKNOWN",
        detail: `HTTP ${code}`,
      };
    }
    if ("lastError" in current) current = current.lastError;
    else if ("cause" in current) current = current.cause;
    else break;
  }
  return outputFailure
    ? { status: "FAIL", detail: "구조화 출력 검증 실패" }
    : {
        status: "UNKNOWN",
        detail: "SDK 호출 실패 — 인증/네트워크/출력 검증 확인 필요",
      };
}

/** 대표 4경로만 실행: tier별 텍스트 3건 + 이메일 Haiku 구조화 출력 1건. */
export async function checkLlmContract(
  resolveModel: (tier: ModelTier) => Promise<string>,
  defaults: Pick<AIGatewayOptions, "provider" | "baseUrl" | "apiKey">,
  structuredModel: string,
  timeoutMs = 90_000,
): Promise<ContractCheck[]> {
  const checks: ContractCheck[] = [];
  for (const tier of ["opus", "gpt", "gemini-pro"] as const) {
    let model = "unresolved";
    try {
      model = await resolveModel(tier);
      const result = await analyzeText("Reply with the number 4 only.", {
        ...defaults,
        model,
        maxOutputTokens: 512,
        timeoutMs,
      });
      const valid =
        result.text.trim().length > 0 && result.finishReason === "stop";
      checks.push({
        status: valid ? "PASS" : "FAIL",
        scope: tier,
        model,
        detail: valid
          ? "text + stop"
          : `빈 결과 또는 미완결 출력 (${result.finishReason})`,
      });
    } catch (error) {
      checks.push({ ...failure(error), scope: tier, model });
    }
  }
  try {
    const result = await analyzeStructured(
      "Return a JSON object with answer equal to 4.",
      z.object({ answer: z.literal(4) }),
      { ...defaults, model: structuredModel, maxOutputTokens: 512, timeoutMs },
    );
    const valid = result.object.answer === 4 && result.finishReason === "stop";
    checks.push({
      status: valid ? "PASS" : "FAIL",
      scope: "haiku-structured",
      model: structuredModel,
      detail: valid ? "schema + stop" : `미완결 출력 (${result.finishReason})`,
    });
  } catch (error) {
    checks.push({
      ...failure(error),
      scope: "haiku-structured",
      model: structuredModel,
    });
  }
  return checks;
}
