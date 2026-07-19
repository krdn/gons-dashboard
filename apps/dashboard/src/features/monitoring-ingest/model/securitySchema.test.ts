// 스키마 자체를 파싱하는 테스트.
//
// judgeSecurity 단위 테스트는 객체 리터럴을 직접 넘겨 스키마를 우회하므로,
// z.discriminatedUnion 의 "판별자 값 중복" 같은 **런타임 구성 오류**를 못 잡는다
// (실제로 typecheck + 단위테스트 전부 통과한 채 통합 테스트에서 터졌다).
// 스키마를 import 해서 parse 하는 경로가 반드시 필요하다.
import { describe, expect, test } from "vitest";
import { securityPayloadSchema } from "./securitySchema";

describe("securityPayloadSchema — 스키마 구성", () => {
  test("모듈 로드 + 빈 객체 파싱이 성공한다 (구성 오류 감지)", () => {
    // discriminatedUnion 구성 오류는 import 시점에 throw 한다.
    expect(securityPayloadSchema.safeParse({}).success).toBe(true);
  });
});

describe("securityPayloadSchema — iptables 판별 유니온", () => {
  test("observed:false + reason 을 받는다", () => {
    const r = securityPayloadSchema.safeParse({
      iptables: { observed: false, reason: "permission-denied" },
    });
    expect(r.success).toBe(true);
  });

  test("observed:true + present:false (체인 삭제)를 받는다", () => {
    const r = securityPayloadSchema.safeParse({
      iptables: { observed: true, present: false },
    });
    expect(r.success).toBe(true);
  });

  test("observed:true + present:true 는 ruleCount·specHash 를 요구한다", () => {
    expect(
      securityPayloadSchema.safeParse({
        iptables: { observed: true, present: true },
      }).success,
    ).toBe(false);

    expect(
      securityPayloadSchema.safeParse({
        iptables: {
          observed: true,
          present: true,
          ruleCount: 6,
          specHash: "abc123",
        },
      }).success,
    ).toBe(true);
  });

  test("observed:true 인데 present 가 없으면 거부한다", () => {
    // 계약을 스키마가 강제하지 않으면 불완전한 payload 가 조용히 통과한다.
    expect(
      securityPayloadSchema.safeParse({ iptables: { observed: true } }).success,
    ).toBe(false);
  });
});

describe("securityPayloadSchema — 나머지 섹션", () => {
  test("정상 payload 전체를 파싱한다", () => {
    const r = securityPayloadSchema.safeParse({
      iptables: { observed: true, present: true, ruleCount: 6, specHash: "h" },
      fail2ban: { observed: true, jails: ["sshd"] },
      ufw: { observed: true, active: true },
      ports: { observed: true, entries: ["tcp:0.0.0.0:3020"] },
      sshFail: { observed: true, failCount1h: 0 },
    });
    expect(r.success).toBe(true);
  });

  test("observed:true 인데 필수 필드가 빠지면 거부한다", () => {
    expect(
      securityPayloadSchema.safeParse({ ufw: { observed: true } }).success,
    ).toBe(false);
    expect(
      securityPayloadSchema.safeParse({ fail2ban: { observed: true } }).success,
    ).toBe(false);
  });
});
