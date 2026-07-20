// 호스트 에이전트 → /api/agent/checks-ingest payload 스키마 (Phase 2).
// scripts/monitoring-agent/agent.sh 의 checks 사이클(60초)이 조립하는 JSON 과 1:1.
// 판정 원자료만 push — 판정은 서버(judgeChecks)가 한다.
import { z } from "zod";
import { securityPayloadSchema } from "./securitySchema";

export const checksPayloadSchema = z.object({
  // hosts.name 과 일치해야 함 (예: "home-server")
  host: z.string().min(1),
  // 미지정 시 서버 수신 시각 사용
  collectedAt: z.string().datetime({ offset: true }).optional(),
  // systemctl is-active 출력 그대로 (active|inactive|failed|activating|...)
  services: z
    .array(
      z.object({
        unit: z.string().min(1).max(100),
        active: z.string().min(1).max(30),
        nRestarts: z.number().int().min(0).optional(),
      }),
    )
    .max(30)
    .optional(),
  // systemctl show <timer> -p LastTriggerUSec/NextElapseUSecRealtime (epoch 초) +
  // 연결된 service 의 Result
  timers: z
    .array(
      z.object({
        unit: z.string().min(1).max(100),
        lastTriggerEpoch: z.number().int().min(0).optional(),
        nextElapseEpoch: z.number().int().min(0).optional(),
        result: z.string().max(30).optional(),
      }),
    )
    .max(30)
    .optional(),
  // 호스트 cron 로그 파일 관찰치. maxAgeMin 은 호스트 env(HOSTCRON_SPECS)가
  // 단일 소스 — 서버는 나이 비교만 한다 (cron 표현식 파싱 불채용, 계획 문서).
  hostCron: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        mtimeEpoch: z.number().int().min(0).optional(),
        sizeBytes: z.number().int().min(0).optional(),
        readable: z.boolean(),
        maxAgeMin: z
          .number()
          .int()
          .min(1)
          .max(60 * 24 * 14),
      }),
    )
    .max(30)
    .optional(),
  // Phase 3 §H — root collector 산출물(/run/gons-monitoring/security.json)을
  // 에이전트가 읽어 그대로 중계한다. 미설정 호스트에서는 생략.
  security: securityPayloadSchema.optional(),
  // Phase 3 §G — DB/Redis liveness 관측치. 특권 불요라 에이전트가 직접 프로브한다.
  //
  // ⚠️ port 를 반드시 싣는다 — 서버가 instances.ts 의 기대 포트와 대조해
  // "엉뚱한 포트를 점검하고 ok" 를 차단한다(spec-mismatch). 에이전트 env 가
  // 낡아 포트가 갈리면 unknown 으로 드러나야 한다.
  datastores: z
    .array(
      z.object({
        kind: z.enum(["pg", "redis"]),
        target: z.string().min(1).max(60),
        port: z.number().int().min(1).max(65535).optional(),
        observed: z.boolean(),
        reachable: z.boolean().optional(),
        reason: z.string().min(1).max(60).optional(),
      }),
    )
    .max(40)
    .optional(),
});

export type ChecksPayload = z.infer<typeof checksPayloadSchema>;
