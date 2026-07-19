// 호스트 에이전트 → /api/agent/metrics-ingest payload 스키마.
// scripts/monitoring-agent/agent.sh 가 조립하는 JSON 과 1:1 대응.
import { z } from "zod";

export const vitalsPayloadSchema = z.object({
  // hosts.name 과 일치해야 함 (예: "home-server")
  host: z.string().min(1),
  // 미지정 시 서버 수신 시각 사용
  collectedAt: z.string().datetime({ offset: true }).optional(),
  cpuPct: z.number().min(0).max(100),
  load1: z.number().min(0),
  load5: z.number().min(0),
  load15: z.number().min(0),
  memUsedPct: z.number().min(0).max(100),
  swapUsedMb: z.number().min(0),
  disks: z
    .array(
      z.object({
        mount: z.string().min(1),
        usedPct: z.number().min(0).max(100),
        inodePct: z.number().min(0).max(100).optional(),
      }),
    )
    .max(20),
  cpuTempC: z.number().optional(),
  gpu: z
    .object({
      utilPct: z.number().min(0).max(100),
      vramPct: z.number().min(0).max(100),
      tempC: z.number(),
    })
    .optional(),
  net: z
    .array(
      z.object({
        iface: z.string().min(1),
        rxBps: z.number().min(0),
        txBps: z.number().min(0),
      }),
    )
    .max(10)
    .optional(),
  uptimeSec: z.number().min(0),
  rebootRequired: z.boolean(),
});

export type VitalsPayload = z.infer<typeof vitalsPayloadSchema>;
