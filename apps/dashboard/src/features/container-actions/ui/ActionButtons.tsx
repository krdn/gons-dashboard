"use client";
import { useState, useTransition } from "react";
import { restartContainer } from "../api/restartContainer";
import { startContainer } from "../api/startContainer";
import { stopContainer } from "../api/stopContainer";
import type { ContainerState } from "@/entities/container/client";
import {
  PlayIcon,
  RestartIcon,
  StopIcon,
  CheckIcon,
  WarningIcon,
} from "@/shared/ui/icons";

type Props = {
  hostId: string;
  containerId: string;
  containerName: string;
  state: ContainerState;
  isAdmin: boolean;
};

const ACTION_FN = {
  restart: restartContainer,
  start: startContainer,
  stop: stopContainer,
} as const;

export function ActionButtons({
  hostId,
  containerId,
  containerName,
  state,
  isAdmin,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  if (!isAdmin) return null;

  function run(action: "restart" | "start" | "stop") {
    const ok = window.confirm(`정말 ${containerName}를 ${action} 할까요?`);
    if (!ok) return;
    startTransition(async () => {
      setMessage(null);
      const result = await ACTION_FN[action]({ hostId, containerId, containerName });
      if (result.ok) {
        setMessage(`${action} 성공`);
      } else {
        setMessage(`${action} 실패 (${result.code})`);
      }
    });
  }

  const canStart = state !== "running" && state !== "restarting";
  const canStop = state === "running" || state === "restarting";

  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      {canStart ? (
        <button
          onClick={() => run("start")}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-2.5 py-1 font-medium text-emerald-700 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-50"
        >
          <PlayIcon size={11} />
          start
        </button>
      ) : null}
      {state === "running" ? (
        <button
          onClick={() => run("restart")}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--color-hairline)] px-2.5 py-1 font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] disabled:opacity-50"
        >
          <RestartIcon size={12} />
          restart
        </button>
      ) : null}
      {canStop ? (
        <button
          onClick={() => run("stop")}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--color-severity-high)] px-2.5 py-1 font-medium text-[var(--color-severity-high)] hover:bg-[oklch(96%_0.04_28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:opacity-50"
        >
          <StopIcon size={10} />
          stop
        </button>
      ) : null}
      {message ? (
        <span className="ml-1 inline-flex items-center gap-1 text-[var(--color-text-subtle)]">
          {message.includes("성공") ? (
            <CheckIcon size={11} className="text-emerald-600" />
          ) : (
            <WarningIcon size={11} className="text-[var(--color-severity-high)]" />
          )}
          {message}
        </span>
      ) : null}
    </div>
  );
}
