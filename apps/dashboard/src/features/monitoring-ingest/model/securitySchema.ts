// 호스트 root collector → 에이전트 → /api/agent/checks-ingest 의 security 섹션 (Phase 3 §H).
// scripts/monitoring-agent/gons-security-collect.sh 가 /run 에 쓴 JSON 과 1:1.
//
// 설계 원칙 — "관측 못 함"을 데이터로 표현한다:
//   명령 실패 출력을 그대로 싣지 않는다. 빈 문자열의 해시나 ports:[] 가
//   정상 관측으로 저장되면 Phase 2 의 0바이트 로그 오탐과 같은 사고가 난다.
//   따라서 모든 항목이 observed 플래그를 동반하고, 실패는 reason 을 싣는다.
import { z } from "zod";

/** 관측 실패 사유 — 자유 문자열이지만 collector 가 쓰는 값의 카탈로그. */
const reasonSchema = z.string().min(1).max(60);

/**
 * iptables 는 판별 유니온이다 — 실패 이유가 두 종류이기 때문.
 *
 *   observed:false                  권한 없음 등 진짜 관측 실패 → unknown
 *   observed:true, present:false    DOCKER-USER 체인 삭제 → critical (방어선 붕괴)
 *   observed:true, present:true     정상 관측 → 기대값 대조
 *
 * `iptables -S DOCKER-USER` 는 위 ①②로 모두 실패하므로 단일 exit code 로 구분할 수
 * 없다(운영 실측: 없는 체인의 오류가 "Incompatible with this kernel" 로 나옴).
 * collector 가 `iptables -S`(전체) 성공 여부로 observed 를, `^-N DOCKER-USER`
 * 매칭으로 present 를 각각 판정해 싣는다.
 */
// ⚠️ discriminatedUnion 은 판별자 값이 유니크해야 한다 — observed:true 분기가 둘이면
//    "Discriminator property observed has duplicate value true" 로 **런타임에** 죽는다
//    (typecheck 는 통과하므로 통합 테스트에서야 드러난다). 판별을 2단으로 중첩한다.
const iptablesObservedSchema = z.discriminatedUnion("present", [
  z.object({ present: z.literal(false) }),
  z.object({
    present: z.literal(true),
    ruleCount: z.number().int().min(0).max(1000),
    // 규칙 스펙(-S)의 공백 정규화 후 sha256 앞 16자.
    // -L -v 는 패킷 카운터가 매 조회마다 변해 거짓 드리프트를 만든다 — 쓰지 않는다.
    specHash: z.string().min(1).max(64),
  }),
]);

export const iptablesObservationSchema = z.union([
  z.object({ observed: z.literal(false), reason: reasonSchema }),
  z
    .object({ observed: z.literal(true) })
    .and(iptablesObservedSchema),
]);

export const securityPayloadSchema = z.object({
  iptables: iptablesObservationSchema.optional(),
  fail2ban: z
    .discriminatedUnion("observed", [
      z.object({ observed: z.literal(false), reason: reasonSchema }),
      z.object({
        observed: z.literal(true),
        jails: z.array(z.string().min(1).max(40)).max(50),
      }),
    ])
    .optional(),
  ufw: z
    .discriminatedUnion("observed", [
      z.object({ observed: z.literal(false), reason: reasonSchema }),
      z.object({ observed: z.literal(true), active: z.boolean() }),
    ])
    .optional(),
  ports: z
    .discriminatedUnion("observed", [
      z.object({ observed: z.literal(false), reason: reasonSchema }),
      z.object({
        observed: z.literal(true),
        // "protocol:bindAddr:port" 튜플 — 포트 번호만 비교하면
        // 127.0.0.1:5434 → 0.0.0.0:5434 노출 확대를 놓친다.
        entries: z.array(z.string().min(3).max(80)).max(300),
      }),
    ])
    .optional(),
  sshFail: z
    .discriminatedUnion("observed", [
      z.object({ observed: z.literal(false), reason: reasonSchema }),
      z.object({
        observed: z.literal(true),
        failCount1h: z.number().int().min(0),
      }),
    ])
    .optional(),
});

export type SecurityPayload = z.infer<typeof securityPayloadSchema>;
export type IptablesObservation = z.infer<typeof iptablesObservationSchema>;
