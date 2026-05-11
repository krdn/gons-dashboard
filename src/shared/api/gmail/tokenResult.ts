// Gmail access token 확보 + InvalidGrantError 분기를 단일 헬퍼로.
//
// 콜사이트는 (getValidAccessToken try-catch + instanceof InvalidGrantError + 각자 fallback)
// 패턴을 3-4 군데에서 반복했다. 이 헬퍼는 raw exception 을 throw 하지 않고 discriminated
// union 결과만 반환 — 호출자는 each 분기에 자신의 ActionResult/SyncResult shape 으로
// 매핑.
//
// 정책:
//   - InvalidGrantError: oauth_state='reauth_required' 가 이미 getValidAccessToken
//     내부에서 set 됨. 호출자는 reason: "reauth-required" 만 받아 UX 분기.
//   - 그 외 예외: "auth-error" (네트워크·일시적 5xx 등). 호출자가 재시도 또는
//     사이클 fail 결정.
//
// 시그니처가 throw 안 한다는 점이 중요 — 콜사이트가 try-catch 없이 await + if 한 줄.

import "server-only";
import { getValidAccessToken } from "./auth";
import { InvalidGrantError } from "./errors";

export type GmailTokenResult =
  | { ok: true; token: string }
  | { ok: false; reason: "reauth-required" | "auth-error" };

export async function getGmailTokenOrResult(
  userId: string,
): Promise<GmailTokenResult> {
  try {
    const { accessToken } = await getValidAccessToken(userId);
    return { ok: true, token: accessToken };
  } catch (err) {
    if (err instanceof InvalidGrantError) {
      return { ok: false, reason: "reauth-required" };
    }
    return { ok: false, reason: "auth-error" };
  }
}
