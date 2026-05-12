// stdio MCP server bootstrap — Claude Code가 자식 프로세스로 spawn하는 진입점.
//
// 입력: ToolDefinition 배열. 출력: stdio MCP 프로토콜로 listen하는 서버 인스턴스.
// 이 모듈은 server-only — SDK가 stdin/stdout을 점유하므로 import 자체에 부수 효과는 없음.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "./zod-to-json-schema";
import type { ToolDefinition } from "./define-tool";

export interface StdioServerOptions {
  name: string;
  version: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: Array<ToolDefinition<any, any>>;
}

export async function runStdioServer(opts: StdioServerOptions): Promise<void> {
  const server = new Server(
    { name: opts.name, version: opts.version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.input),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = opts.tools.find((t) => t.name === request.params.name);
    if (!tool) {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }
    const result = await tool.handler(request.params.arguments ?? {});
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result, null, 2) },
      ],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
