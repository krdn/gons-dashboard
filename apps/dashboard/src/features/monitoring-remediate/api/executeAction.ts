// 조치 실행 디스패치 (이슈 #352).
// 모든 조치는 기존 runDocker 를 경유한다 — 새 권한 경로를 만들지 않는다.
import "server-only";
import { runDocker } from "@/shared/lib/docker";
import { executeContainerAction } from "@/features/container-actions/api/executeContainerAction";
import { type RemediationAction } from "../config/policies";

/** 감사 로그에서 사람 조치와 구분하기 위한 actor. */
export const REMEDIATE_ACTOR = "system:auto-remediate";

export async function executeAction(
  action: RemediationAction,
  hostContext: string,
): Promise<{ ok: boolean; message?: string }> {
  switch (action.kind) {
    case "restart-container": {
      const r = await executeContainerAction(
        "restart",
        {
          hostId: action.hostId,
          containerId: action.containerId,
          containerName: action.containerName,
        },
        REMEDIATE_ACTOR,
      );
      return r.ok ? { ok: true } : { ok: false, message: r.code };
    }
    case "prune-images": {
      // dangling 한정 — volume 과 named image 는 건드리지 않는다.
      await runDocker(hostContext, ["image", "prune", "-f"]);
      return { ok: true };
    }
    case "raise-redis-maxmemory": {
      await runDocker(hostContext, [
        "exec",
        action.target,
        "redis-cli",
        "CONFIG",
        "SET",
        "maxmemory",
        String(action.nextBytes),
      ]);
      return { ok: true };
    }
  }
}
