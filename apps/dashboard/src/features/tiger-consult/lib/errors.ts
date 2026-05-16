// PlayMCP 호출의 5계층 에러 분류 (spec §7).

export class PlayMCPNotConfiguredError extends Error {
  readonly code = "L1_NOT_CONFIGURED" as const;
  constructor(message?: string) {
    super(message ?? "playmcp_credentials 미설정. tiger:bootstrap 필요.");
    this.name = "PlayMCPNotConfiguredError";
  }
}

export class PlayMCPAuthError extends Error {
  readonly code = "L1_AUTH" as const;
  readonly recoverable: boolean;
  constructor(message: string, opts?: { recoverable?: boolean }) {
    super(message);
    this.name = "PlayMCPAuthError";
    this.recoverable = opts?.recoverable ?? false;
  }
}

export class PlayMCPNetworkError extends Error {
  readonly code = "L2_NETWORK" as const;
  readonly recoverable = true as const;
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "PlayMCPNetworkError";
  }
}

export class PlayMCPInputError extends Error {
  readonly code = "L3_INPUT" as const;
  readonly recoverable = false as const;
  constructor(message: string, readonly field?: string) {
    super(message);
    this.name = "PlayMCPInputError";
  }
}

export class PlayMCPCrossTalkDetectedError extends Error {
  readonly code = "L4_CROSS_TALK" as const;
  readonly recoverable = false as const;
  constructor(readonly reason: string, readonly tool: string, readonly profileId: string) {
    super(`PlayMCP cross-talk detected: ${reason} (tool=${tool}, profileId=${profileId})`);
    this.name = "PlayMCPCrossTalkDetectedError";
  }
}

export class PlayMCPSchemaError extends Error {
  readonly code = "L5_SCHEMA" as const;
  readonly recoverable = false as const;
  constructor(message: string) {
    super(message);
    this.name = "PlayMCPSchemaError";
  }
}

export type PlayMCPError =
  | PlayMCPNotConfiguredError
  | PlayMCPAuthError
  | PlayMCPNetworkError
  | PlayMCPInputError
  | PlayMCPCrossTalkDetectedError
  | PlayMCPSchemaError;

export function isPlayMCPError(err: unknown): err is PlayMCPError {
  return (
    err instanceof PlayMCPNotConfiguredError ||
    err instanceof PlayMCPAuthError ||
    err instanceof PlayMCPNetworkError ||
    err instanceof PlayMCPInputError ||
    err instanceof PlayMCPCrossTalkDetectedError ||
    err instanceof PlayMCPSchemaError
  );
}
