# 관제 Phase 2 (스케줄·가용성) + Phase 1 잔여 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). 이슈 #323 Phase 2.

**Goal:** systemd 서비스/타이머·호스트 cron 판정, HTTP 체크 10사이트, SSL D-day, critical 알림 발송(텔레그램+web-push), 비-factory cron 3종 계측.

**Architecture:** Phase 1 인프라 재사용 — 에이전트가 60초 주기로 `/api/agent/checks-ingest`에 판정 원자료 push → 서버 순수함수 판정 → 신규 `check_results` 테이블 + 기존 `monitoring_events` dedup. HTTP/SSL은 앱 cron이 직접 프로브. 알림은 매분 sweep cron이 미통지 critical을 발송.

**Tech:** Drizzle(0048), zod, node https(프로브), web-push(기존 lib), Telegram Bot API(fetch).

## 범위 결정 (묻지 않고 확정한 것)

- **cron 표현식 파서 불채용** — `HOSTCRON_SPECS="name|logPath|maxAgeMin"`을 호스트 env에 두고 에이전트가 maxAgeMin을 payload에 포함. 서버는 나이 비교만. age>maxAge→warning, age>2×maxAge→critical.
- **판정 원자료는 에이전트, 판정은 서버** — systemctl is-active/show, stat 결과를 push. repo측 레지스트리 파일 없음(단일 소스=호스트 env).
- **HTTP 프로브 hairpin 회피** — `HTTP_CHECK_CONNECT_IP`(optional env, 운영=192.168.0.5)로 connect, SNI/Host는 도메인. 인증서 daysLeft도 같은 프로브에서 추출(SSL cron 재사용).
- **3연속 실패 → critical** (전 사이트 동일 — cli-proxy 가중치는 YAGNI 보류). 단발 실패는 row status=warning만.
- **SSL**: D-14 warning / D-7 critical / 그 외 resolve. 매일 10:40 KST.
- **알림**: critical open(notified_at null) + critical resolved(회복 통지) sweep. cooldown 30분(동일 dedup_key 최근 통지 존재 시 발송 생략+마킹). 채널: 텔레그램(optional env) + web-push(ADMIN_EMAILS 사용자). warning은 대시보드만.
- **autopilot-cycle/notify·krx-master-sync**: 라우트 내 recordCronRun 수동 호출(기존 응답 구조 불변).
- **check_results 보존 48h** (monitoring-purge에 4번째 target 추가).
- **텔레그램 스크립트 은퇴는 Phase 4** — 이번엔 발송만 추가(중복 알림 일부 허용).

## Tasks

- [ ] **T1 스키마+마이그레이션 0048**: `check_results`(id, kind, target, status, detail jsonb, hostId?, checkedAt + (kind,target,checkedAt desc) idx + checkedAt idx) + `monitoring_events`에 `notified_at`,`resolved_notified_at`. entities/monitoring model/types 확장.
- [ ] **T2 entities/monitoring/api/checks.ts**: insertCheckResults, listLatestChecks(DISTINCT ON (kind,target)), getRecentChecks(kind,target,limit). server.ts export. 통합 테스트(기존 monitoring-queries 패턴).
- [ ] **T3 features/monitoring-ingest 확장**: checksSchema(zod: services/timers/hostCron 각 ≤30), judgeChecks(순수 — 판정표는 아래), ingestChecks(host 조회→판정→check_results insert→record/resolveEvent best-effort). 순수함수 유닛 테스트.
  - service: active=="failed"→critical / "active"→ok / 그외→warning. dedup `svc:{hostId}:{unit}`
  - timer: result!="success"→warning; nextElapse<now-30m→warning(지연); else ok. dedup `timer:{hostId}:{unit}`
  - hostcron: !readable→unknown(무이벤트); age 판정 위 참조. dedup `hostcron:{hostId}:{name}`
- [ ] **T4 /api/agent/checks-ingest route**: metrics-ingest 미러(동일 토큰·401/400/404/500/200).
- [ ] **T5 features/monitoring-availability**: config/sites.ts(10사이트: afterschool/all/claude/gons/gonsai/krdn/n8n/news/ollama/voice — gons는 /api/health), lib/probeSite.ts(https.request, servername=도메인, connect=env ip? : 도메인, timeout 10s, statusCode+latency+certDaysLeft), lib/judgeHttp.ts(순수: 현재+직전2회→상태/이벤트 여부), runHttpChecks/runSslChecks. judgeHttp 유닛 테스트.
- [ ] **T6 cron 라우트 3개**: check-http(매분), check-ssl(10:40), monitoring-notify(매분) — 모두 createCronHandler. notify: open critical(notified null)→cooldown 판정→텔레그램(env 있을 때)+ADMIN_EMAILS web-push→마킹; resolved critical(resolved_notified null·notified not null)→회복 통지→마킹. shared/lib/telegram.ts(sendTelegram — optional env, 실패 무해).
- [ ] **T7 monitoring-purge**: check_results<48h target 추가.
- [ ] **T8 비-factory 3종 계측**: autopilot-cycle/notify, krx-master-sync에 recordCronRun.
- [ ] **T9 agent.sh v2**: WATCH_SERVICES/WATCH_TIMERS/HOSTCRON_SPECS env, 4사이클(60s)마다 checks payload 빌드→2번째 POST. README·service 파일 문서 갱신. --dry-run에 checks 포함.
- [ ] **T10 UI 3보드**: AvailabilityBoard(HTTP+SSL 병합: site/status/latency/D-day), ServicesBoard(서비스+타이머), HostCronBoard. page.tsx 드릴다운에 배치(2열 grid). barrel.
- [ ] **T11 env/compose/scheduler**: env.ts에 TELEGRAM_BOT_TOKEN?/TELEGRAM_CHAT_ID?/HTTP_CHECK_CONNECT_IP?(전부 optional — Dockerfile/ci placeholder 불필요), .env.example, docker-compose(`${VAR:-}`), scheduler.js 3잡+로그 문자열.
- [ ] **T12 검증·리뷰·PR**: typecheck/lint/test/build → Codex 리뷰(래퍼 스크립트, 정적) → PR → auto-merge.
- [ ] **T13 배포**: 0048 psql 선적용 → compose scp 교체(메모리: git 미동기화) → .env에 TELEGRAM 값(서버 기존 스크립트에서 회수)+HTTP_CHECK_CONNECT_IP 추가 → 이미지 digest 갱신 pull/up --no-deps → agent.sh+/etc/default 갱신·재시작 → 가동 검증(check_results 유입, 이벤트, 알림 dry).

## 함정 체크리스트 (메모리 승계)
- 운영 DB psql 수동 선적용, compose scp, APP_IMAGE_REF digest sed, --no-deps, TEST_DATABASE_URL, features barrel server/client seam(신규 feature는 server-only만 — client export 없음), 수집 잡 catchup 제외.
