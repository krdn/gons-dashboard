import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { checkLlmContract } from "./consumer-contract";

// ai/provider SDK를 mock하지 않는다. 설치된 gateway가 실제로 보내는 HTTP를 검사한다.
let server: Server;
afterEach(async () => {
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function fixture(
  reply: (model: string) => {
    code?: number;
    content?: string;
    finish?: string;
  },
) {
  const requests: { path: string; auth: string | undefined; model: string }[] =
    [];
  server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const { model } = JSON.parse(body);
    requests.push({ path: req.url!, auth: req.headers.authorization, model });
    const response = reply(model);
    res.writeHead(response.code ?? 200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        response.code
          ? {
              error: {
                message: "fixture error",
                type: "invalid_request_error",
              },
            }
          : {
              id: "fixture",
              object: "chat.completion",
              created: 1,
              model,
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: response.content ?? "4",
                  },
                  finish_reason: response.finish ?? "stop",
                },
              ],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 5,
                total_tokens: 15,
              },
            },
      ),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  return {
    requests,
    defaults: {
      provider: "claude-cli" as const,
      baseUrl: `http://127.0.0.1:${address.port}`,
      apiKey: "fixture-key",
    },
  };
}

describe("consumer contract — installed SDK HTTP", () => {
  it("텍스트 3건과 구조화 1건을 실제 SDK로 검증한다", async () => {
    const { requests, defaults } = await fixture((model) => ({
      content: model === "haiku" ? '{"answer":4}' : "4",
    }));
    const checks = await checkLlmContract(
      async (tier) => tier,
      defaults,
      "haiku",
    );
    expect(checks.map((check) => check.status)).toEqual([
      "PASS",
      "PASS",
      "PASS",
      "PASS",
    ]);
    expect(requests).toHaveLength(4);
    expect(
      requests.every(
        (r) =>
          r.path === "/v1/chat/completions" && r.auth === "Bearer fixture-key",
      ),
    ).toBe(true);
  });

  it("200 빈 본문/절단/400을 정상으로 판정하지 않는다", async () => {
    const { defaults } = await fixture((model) =>
      model === "opus"
        ? { content: "" }
        : model === "gpt"
          ? { finish: "length" }
          : model === "gemini-pro"
            ? { code: 400 }
            : { content: '{"answer":4}' },
    );
    const checks = await checkLlmContract(
      async (tier) => tier,
      defaults,
      "haiku",
    );
    expect(checks.map((c) => c.status)).toEqual([
      "FAIL",
      "FAIL",
      "FAIL",
      "PASS",
    ]);
    expect(checks[2].detail).toBe("HTTP 400");
  });

  it("429는 SDK 재시도 이후에도 미검증이며 다른 경로는 계속 검사한다", async () => {
    const { defaults } = await fixture((model) =>
      model === "opus"
        ? { code: 429 }
        : { content: model === "haiku" ? '{"answer":4}' : "4" },
    );
    const checks = await checkLlmContract(
      async (tier) => tier,
      defaults,
      "haiku",
    );
    expect(checks.map((c) => c.status)).toEqual([
      "UNKNOWN",
      "PASS",
      "PASS",
      "PASS",
    ]);
    expect(checks[0].detail).toBe("HTTP 429");
  }, 15_000);
});

it("200 구조화 응답이 스키마를 어기면 확정 실패로 판정한다", async () => {
  const { requests, defaults } = await fixture((model) => ({
    content: model === "haiku" ? '{"answer":5}' : "4",
  }));
  const checks = await checkLlmContract(
    async (tier) => tier,
    defaults,
    "haiku",
  );
  expect(checks.map((c) => c.status)).toEqual(["PASS", "PASS", "PASS", "FAIL"]);
  expect(checks[3].detail).toBe("구조화 출력 검증 실패");
  expect(requests.filter((r) => r.model === "haiku")).toHaveLength(2);
});
