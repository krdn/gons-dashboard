"use client";
import { useState, useTransition } from "react";
import { restartContainer } from "../api/restartContainer";
import { startContainer } from "../api/startContainer";
import { stopContainer } from "../api/stopContainer";
import type { ContainerState } from "@/entities/container/model/types";

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
        setMessage(`✓ ${action} 성공`);
      } else {
        setMessage(`✕ ${action} 실패 (${result.code})`);
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
          className="rounded-md border border-emerald-200 px-2.5 py-1 font-medium text-emerald-700 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-50"
        >
          ▶ start
        </button>
      ) : null}
      {state === "running" ? (
        <button
          onClick={() => run("restart")}
          disabled={pending}
          className="rounded-md border border-zinc-200 px-2.5 py-1 font-medium text-zinc-700 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 disabled:opacity-50"
        >
          ⟳ restart
        </button>
      ) : null}
      {canStop ? (
        <button
          onClick={() => run("stop")}
          disabled={pending}
          className="rounded-md border border-rose-200 px-2.5 py-1 font-medium text-rose-700 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:opacity-50"
        >
          ⏸ stop
        </button>
      ) : null}
      {message ? (
        <span className="ml-1 text-zinc-500">{message}</span>
      ) : null}
    </div>
  );
}
