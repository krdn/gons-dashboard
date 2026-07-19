// HTTPS 프로브 — 상태코드·지연시간·인증서 잔여일을 한 연결로 수집.
//
// hairpin NAT 회피: 앱 컨테이너가 같은 호스트의 nginx 를 공인 IP 로 돌아
// 나갔다 오면 홈 라우터에서 실패할 수 있어, connectIp(LAN)로 접속하되
// SNI(servername)·Host 헤더는 도메인으로 유지 — 인증서 검증도 도메인 기준.
import { request } from "node:https";
import { type TLSSocket } from "node:tls";

export interface ProbeResult {
  /** HTTP 응답 수신 + statusCode < 500. 4xx 는 up (인증 보호 사이트 오탐 방지). */
  up: boolean;
  httpStatus?: number;
  latencyMs: number;
  certDaysLeft?: number;
  error?: string;
}

export function probeSite(opts: {
  domain: string;
  path?: string;
  connectIp?: string;
  timeoutMs?: number;
}): Promise<ProbeResult> {
  const { domain, path = "/", connectIp, timeoutMs = 10_000 } = opts;
  const startedAt = Date.now();

  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const req = request(
      {
        host: connectIp ?? domain,
        servername: domain,
        port: 443,
        path,
        method: "GET",
        headers: { Host: domain, "User-Agent": "gons-monitoring/1" },
        timeout: timeoutMs,
      },
      (res) => {
        const latencyMs = Date.now() - startedAt;
        const socket = res.socket as TLSSocket;
        const cert =
          typeof socket.getPeerCertificate === "function"
            ? socket.getPeerCertificate()
            : undefined;
        const validTo = cert?.valid_to ? Date.parse(cert.valid_to) : NaN;
        const certDaysLeft = Number.isFinite(validTo)
          ? Math.floor((validTo - Date.now()) / 86_400_000)
          : undefined;
        res.resume(); // body 비소비 시 소켓이 열려 있음 — 즉시 흘려보냄
        settle({
          up: res.statusCode != null && res.statusCode < 500,
          httpStatus: res.statusCode,
          latencyMs,
          ...(certDaysLeft != null ? { certDaysLeft } : {}),
        });
      },
    );

    req.on("timeout", () => {
      req.destroy(new Error(`timeout ${timeoutMs}ms`));
    });
    req.on("error", (err) => {
      settle({
        up: false,
        latencyMs: Date.now() - startedAt,
        error: err.message,
      });
    });
    req.end();
  });
}
