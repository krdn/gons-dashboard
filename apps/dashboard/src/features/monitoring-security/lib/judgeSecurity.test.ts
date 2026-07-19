import { describe, expect, test } from "vitest";
import { judgeSecurity } from "./judgeSecurity";
import { EXPECTED_IPTABLES, SSH_FAIL_THRESHOLD } from "../config/baseline";
import { type SecurityPayload } from "@/features/monitoring-ingest";

/** (kind, status) 로 verdict 를 뽑는 헬퍼 — 순서에 의존하지 않기 위해. */
function byKind(payload: SecurityPayload, kind: string) {
  const v = judgeSecurity(payload).find((x) => x.kind === kind);
  if (!v) throw new Error(`verdict 없음: ${kind}`);
  return v;
}

describe("judgeSecurity — 관측 공백", () => {
  test("빈 payload 에도 5종 verdict 를 모두 생성한다", () => {
    // 관측치가 없다고 verdict 를 건너뛰면 check_results 에 새 행이 안 생겨
    // 보드에 이전 상태가 남는다 (관측 공백이 정상으로 보이는 미탐).
    const verdicts = judgeSecurity({});
    expect(verdicts).toHaveLength(5);
    expect(verdicts.every((v) => v.status === "unknown")).toBe(true);
    expect(new Set(verdicts.map((v) => v.kind))).toEqual(
      new Set(["iptables", "fail2ban", "ufw", "portdrift", "sshfail"]),
    );
  });

  test("observed:false 는 unknown 이고 reason 을 detail 에 싣는다", () => {
    const v = byKind(
      { fail2ban: { observed: false, reason: "permission-denied" } },
      "fail2ban",
    );
    expect(v.status).toBe("unknown");
    expect(v.detail.reason).toBe("permission-denied");
  });
});

describe("judgeSecurity — iptables (인터넷 방어선)", () => {
  test("체인 삭제(present:false)는 unknown 이 아니라 critical", () => {
    // 관측 실패와 체인 삭제를 뭉개면 방어선 소멸에 관제가 침묵한다.
    const v = byKind({ iptables: { observed: true, present: false } }, "iptables");
    expect(v.status).toBe("critical");
    expect(v.detail.present).toBe(false);
  });

  test("권한 실패는 critical 이 아니라 unknown", () => {
    const v = byKind(
      { iptables: { observed: false, reason: "permission-denied" } },
      "iptables",
    );
    expect(v.status).toBe("unknown");
  });

  test("기대값과 일치하면 ok", () => {
    const v = byKind(
      {
        iptables: {
          observed: true,
          present: true,
          ruleCount: EXPECTED_IPTABLES.ruleCount,
          specHash: EXPECTED_IPTABLES.specHash,
        },
      },
      "iptables",
    );
    expect(v.status).toBe("ok");
  });

  test("규칙 수는 같아도 해시가 다르면 critical (내용 변조)", () => {
    const v = byKind(
      {
        iptables: {
          observed: true,
          present: true,
          ruleCount: EXPECTED_IPTABLES.ruleCount,
          specHash: "tampered-hash",
        },
      },
      "iptables",
    );
    expect(v.status).toBe("critical");
    expect(v.title).toContain("내용 변경");
  });

  test("규칙 수가 다르면 critical", () => {
    const v = byKind(
      {
        iptables: {
          observed: true,
          present: true,
          ruleCount: EXPECTED_IPTABLES.ruleCount - 1,
          specHash: EXPECTED_IPTABLES.specHash,
        },
      },
      "iptables",
    );
    expect(v.status).toBe("critical");
    expect(v.title).toContain("규칙 수 변경");
  });
});

describe("judgeSecurity — fail2ban", () => {
  test("sshd jail 이 있으면 ok", () => {
    const v = byKind(
      { fail2ban: { observed: true, jails: ["sshd", "nginx-limit"] } },
      "fail2ban",
    );
    expect(v.status).toBe("ok");
  });

  test("jail 이 여럿이어도 sshd 가 빠지면 warning", () => {
    // 개수만 보면(jailCount>0) sshd 이탈을 놓친다.
    const v = byKind(
      { fail2ban: { observed: true, jails: ["nginx-limit", "recidive"] } },
      "fail2ban",
    );
    expect(v.status).toBe("warning");
    expect(v.detail.missing).toEqual(["sshd"]);
  });
});

describe("judgeSecurity — ufw", () => {
  test("inactive 는 critical", () => {
    expect(byKind({ ufw: { observed: true, active: false } }, "ufw").status).toBe(
      "critical",
    );
  });
  test("active 는 ok", () => {
    expect(byKind({ ufw: { observed: true, active: true } }, "ufw").status).toBe(
      "ok",
    );
  });
});

describe("judgeSecurity — 포트 드리프트", () => {
  test("허용목록 밖 소켓이 등장하면 warning", () => {
    const v = byKind(
      { ports: { observed: true, entries: ["tcp:0.0.0.0:9999"] } },
      "portdrift",
    );
    expect(v.status).toBe("warning");
    expect(v.detail.unexpected).toEqual(["tcp:0.0.0.0:9999"]);
  });

  test("bind 주소만 넓어져도(127.0.0.1→0.0.0.0) 잡는다", () => {
    // 포트 번호만 비교하면 노출 확대를 놓친다 — 튜플 비교의 존재 이유.
    const loopbackOnly = byKind(
      { ports: { observed: true, entries: ["tcp:127.0.0.1:5434"] } },
      "portdrift",
    );
    const exposed = byKind(
      { ports: { observed: true, entries: ["tcp:0.0.0.0:5434"] } },
      "portdrift",
    );
    // 두 항목은 서로 다른 튜플이므로 허용목록 판정이 독립적이다.
    expect(loopbackOnly.detail.unexpected).not.toEqual(
      exposed.detail.unexpected,
    );
  });

  test("빈 목록은 위반 없음 (사라진 포트는 무이벤트)", () => {
    const v = byKind({ ports: { observed: true, entries: [] } }, "portdrift");
    expect(v.status).toBe("ok");
  });
});

describe("judgeSecurity — SSH 실패", () => {
  test("임계 이하는 ok", () => {
    const v = byKind(
      { sshFail: { observed: true, failCount1h: SSH_FAIL_THRESHOLD } },
      "sshfail",
    );
    expect(v.status).toBe("ok");
  });

  test("임계 초과는 warning", () => {
    const v = byKind(
      { sshFail: { observed: true, failCount1h: SSH_FAIL_THRESHOLD + 1 } },
      "sshfail",
    );
    expect(v.status).toBe("warning");
  });
});
