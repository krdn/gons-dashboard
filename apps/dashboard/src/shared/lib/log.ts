// 구조화 로그 — JSON 한 줄 stdout 출력.
//
// cron / app 컨테이너의 stdout 은 `docker logs` 로 수집되고, jq 로 필터 가능하다.
// 호출자는 (scope, event, context) 패턴을 따른다:
//   logger.warn("classify-important", "llm-error", { threadId, message })
// → {"level":"warn","scope":"classify-important","event":"llm-error","threadId":"...","message":"...","ts":"2026-05-11T..."}
//
// 향후 pino 또는 다른 logger 라이브러리로 교체할 경우 본 모듈의 함수 본체만 갱신.
// 호출 측의 시그니처를 깨지 않게 유지.

import "server-only";

type LogLevel = "info" | "warn" | "error";
type LogContext = Record<string, unknown>;

function emit(
  level: LogLevel,
  scope: string,
  event: string,
  context: LogContext = {},
): void {
  const record = {
    level,
    scope,
    event,
    ts: new Date().toISOString(),
    ...context,
  };
  // 안전 직렬화: BigInt, circular ref 등은 String 으로 강등.
  let serialized: string;
  try {
    serialized = JSON.stringify(record);
  } catch {
    serialized = JSON.stringify({
      level,
      scope,
      event,
      ts: record.ts,
      _logger_error: "non-serializable context",
    });
  }
  if (level === "error") {
    console.error(serialized);
  } else if (level === "warn") {
    console.warn(serialized);
  } else {
    console.log(serialized);
  }
}

export const logger = {
  info(scope: string, event: string, context?: LogContext): void {
    emit("info", scope, event, context);
  },
  warn(scope: string, event: string, context?: LogContext): void {
    emit("warn", scope, event, context);
  },
  error(scope: string, event: string, context?: LogContext): void {
    emit("error", scope, event, context);
  },
};
