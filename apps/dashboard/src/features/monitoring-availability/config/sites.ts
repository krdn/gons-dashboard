// Synthetic HTTP 체크 대상 — 운영 nginx 사이트 10개 (이슈 #323 §E).
// 도메인은 2026-07-19 운영 서버 /etc/nginx/sites-enabled/ 실사 기준.
// path: 내부 헬스 엔드포인트가 있으면 그것 우선 (§E — 현재 gons 만 해당).
export interface SiteCheck {
  /** 도메인 = check_results.target = 이벤트 dedup 키의 대상 식별자. */
  domain: string;
  path: string;
}

export const MONITORED_SITES: SiteCheck[] = [
  { domain: "afterschool.krdn.kr", path: "/" },
  { domain: "all.krdn.kr", path: "/" },
  // cli-proxy-api — ais 36개 모듈 의존 (§E). 비인증 응답도 <500 이면 up.
  { domain: "claude.krdn.kr", path: "/" },
  { domain: "gons.krdn.kr", path: "/api/health" },
  { domain: "gonsai.krdn.kr", path: "/" },
  { domain: "krdn.kr", path: "/" },
  { domain: "n8n.krdn.kr", path: "/" },
  { domain: "news.krdn.kr", path: "/" },
  { domain: "ollama.krdn.kr", path: "/" },
  { domain: "voice.krdn.kr", path: "/" },
];
