# Phase 8: Browser 검증 + 운영 배포

> 부모: `../2026-05-21-stock-analysis-widget.md`

**범위:** Phase 1~7 의 도메인 코드를 운영에서 실제로 dogfooding 하고 (종목 등록, 분석 수동 트리거, cron 동작 확인) Definition of Done (spec §8) 의 1~6 + 7 (edge case) 를 사용자 본인이 검증.

**완료 조건:**
- Google OAuth 정식 키 + (선택) VAPID 정식 키 + (선택) PLAYMCP_CLIENT_ID 운영 .env 에 반영
- 종목 3종 등록 (예: `005930.KS` 삼성전자, `NVDA` NVIDIA, `BTC-USD` BTC)
- 좌 7-grid `StockAnalysisCard` 헤드라인 + 리스트 표시
- 자세히 보기 모달 — 5 페르소나 탭 + 합의 hero + 차트 + 면책 footer
- 설정 모달 LLM 탭 — 모델 override 동작
- 수동 cron trigger 1회 (`/api/cron/stock-analyze?market=US_GLOBAL`) → `stock_analysis_cache` 글로벌 row 생성 확인
- 자연 발생 cron (KST 16:30 / 06:30) 다음 fire 후 로그 확인
- 발견한 새 함정은 CLAUDE.md Gotcha 추가 (현재 §7, §8, §9 까지 진행)

**전제 (Phase 7 종료 시점 상태):**
- 운영 app/cron healthy (`gons-dashboard-app sha256:5ec5f77c2a43…`)
- 운영 DB 0025 까지 적용 (`stock_consensus_flips.detected_date` + `flips_dedup_uq`)
- cron 스케줄 6개 등록 (poll-gmail / morning-digest / daily-fortunes / daily-tri / stock-kr / stock-us)
- `.env` 의 placeholder: `GOOGLE_CLIENT_ID / SECRET = changeme-*`, `PLAYMCP_CLIENT_ID = changeme-*`. VAPID 는 자동 생성 키 (정식 발급 후 교체 시 push 정상화)

---

## Task 8.1: 운영 DB 마이그레이션 (이미 완료 — 참고용)

Phase 6 머지 후 0023/0024 적용 완료. Phase 7 머지 후 0025 적용 완료 (`detected_date` generated column + `flips_dedup_uq`).

신규 마이그레이션 생기면 동일 흐름:
```bash
# 로컬 .env DATABASE_URL 이 운영 향하는지 확인 후
I_KNOW_THIS_IS_PROD=1 pnpm db:migrate
# 검증
ssh gon@192.168.0.5 "docker exec gons-dashboard-postgres psql -U gons -d gons_dashboard -c 'SELECT id, hash FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 3;'"
```

---

## Task 8.2: Google OAuth 정식 키 발급 (사용자 작업)

현재 `.env` 의 `GOOGLE_CLIENT_ID = changeme-google-client-id` 로 로그인 실패. 정식 키 발급 + 교체 필요.

### 절차

1. https://console.cloud.google.com/apis/credentials 접속 (krdn.net@gmail.com 계정)
2. 기존 OAuth 2.0 Client ID 찾거나 새로 생성 (Application type: Web)
3. Authorized redirect URIs 에 다음 추가:
   - `https://gons.krdn.kr/api/auth/callback/google`
   - `http://localhost:3020/api/auth/callback/google` (로컬 개발용)
4. Client ID + Client Secret 복사
5. 운영 .env 갱신:
   ```bash
   ssh gon@192.168.0.5 "sudo sed -i \
     -e 's|^GOOGLE_CLIENT_ID=.*|GOOGLE_CLIENT_ID=<NEW_ID>|' \
     -e 's|^GOOGLE_CLIENT_SECRET=.*|GOOGLE_CLIENT_SECRET=<NEW_SECRET>|' \
     /home/gon/projects/gon/gons-dashboard/.env"
   ```
6. app 컨테이너 재시작:
   ```bash
   ssh gon@192.168.0.5 "docker compose -f /home/gon/projects/gon/gons-dashboard/docker-compose.yml --env-file /home/gon/projects/gon/gons-dashboard/.env up -d --force-recreate app"
   ```
7. 백업본도 동시 갱신 (1Password 도):
   ```bash
   ssh gon@192.168.0.5 "sudo cat /home/gon/projects/gon/gons-dashboard/.env" \
     > ~/.gstack/projects/gons-dashboard/secrets/prod.env.$(date +%Y%m%d-%H%M%S)
   ```
8. `https://gons.krdn.kr` 접속 → Google 로그인 시도 → 정상 redirect 확인

---

## Task 8.3: docker compose pull/up (이미 완료 — 참고용)

Phase 7 머지 후 새 image `sha256:5ec5f77c2a43…` 적용 완료. 향후 PR 머지마다 동일 흐름:

```bash
COMPOSE=/home/gon/projects/gon/gons-dashboard/docker-compose.yml
ENVFILE=/home/gon/projects/gon/gons-dashboard/.env
ssh gon@192.168.0.5 "docker compose -f $COMPOSE --env-file $ENVFILE pull app cron"
ssh gon@192.168.0.5 "docker compose -f $COMPOSE --env-file $ENVFILE up -d app cron"
# 검증
ssh gon@192.168.0.5 "curl -s http://localhost:3020/api/health"
ssh gon@192.168.0.5 "docker logs gons-dashboard-cron 2>&1 | grep '스케줄 등록' | tail -1"
```

---

## Task 8.4: CLAUDE.md Gotcha 추가 (이미 완료)

Phase 6+7 도중 발견한 함정 3개를 CLAUDE.md 에 추가 완료:

- **§7 features barrel server/client seam** — Phase 6 PR-back 사고 패턴
- **§8 운영 compose+env 백업 필수** — Phase 7 도중 working_dir 실종 사고
- **§9 PostgreSQL timestamptz::date IMMUTABLE 위반** — Phase 7 generated column 우회

---

## Task 8.5: dogfooding — 종목 등록 + cron 검증 (사용자 작업)

Google OAuth 정상화 후 진행.

### 8.5.1 종목 등록

브라우저 `https://gons.krdn.kr` 접속:

1. ⚙ 설정 모달 (또는 `StockAnalysisCard` 우상단 아이콘) → 포트폴리오 탭
2. 다음 3종 추가:
   - 삼성전자: `005930.KS`, market=KR, asset_class=stock, 수량 10, 평단 70000
   - NVIDIA: `NVDA`, market=US, asset_class=stock, 수량 5, 평단 150
   - 비트코인: `BTC-USD`, market=CRYPTO, asset_class=crypto, 수량 0.1, 평단 60000

(저장 후) DB 에서 row 확인:
```bash
ssh gon@192.168.0.5 "docker exec gons-dashboard-postgres psql -U gons -d gons_dashboard -c 'SELECT symbol, market, asset_class, quantity, avg_cost FROM portfolio_holdings ORDER BY created_at;'"
```

### 8.5.2 widget 검증

대시보드 메인:
- 좌 7-grid 에 `StockAnalysisCard` 표시 — 헤드라인 종목 hero + 리스트
- "지금 분석" 버튼 (`AnalysisPendingPlaceholder`) 클릭 → 30~60초 폴링 후 헤드라인 자동 갱신
- 종목 클릭 → `StockDetailModal` (자세히 보기) — 합의 hero + 페르소나 5 탭 + 차트 + 펀더멘털 + 면책 footer
- 설정 모달 → LLM 탭 → 특정 페르소나 모델을 `claude` → `codex` 로 override → 저장 → "재생성" 버튼 → 새 모델로 호출됐는지 응답 확인

### 8.5.3 수동 cron trigger

```bash
TOKEN=$(ssh gon@192.168.0.5 "sudo grep '^CRON_BEARER_TOKEN=' /home/gon/projects/gon/gons-dashboard/.env | cut -d= -f2")

# US_GLOBAL (NVIDIA + BTC 대상)
ssh gon@192.168.0.5 "curl -s -X POST -H 'Authorization: Bearer $TOKEN' 'http://localhost:3020/api/cron/stock-analyze?market=US_GLOBAL'" | jq .

# KR (삼성전자 대상)
ssh gon@192.168.0.5 "curl -s -X POST -H 'Authorization: Bearer $TOKEN' 'http://localhost:3020/api/cron/stock-analyze?market=KR'" | jq .
```

응답 envelope 확인 — `total: 2|1`, `succeeded: <count>`, `failed: <count>`. fail 이 있다면 `results[].error` 메시지 확인.

### 8.5.4 자연 발생 cron 확인

- 다음 KST 16:30 (KR) 또는 06:30 (US_GLOBAL) 시각에 자동 fire 됨
- 발생 후 로그:
  ```bash
  ssh gon@192.168.0.5 "docker logs gons-dashboard-cron 2>&1 | grep -E 'stock-kr|stock-us' | tail -10"
  ```
- DB 캐시 row 확인:
  ```bash
  ssh gon@192.168.0.5 "docker exec gons-dashboard-postgres psql -U gons -d gons_dashboard -c 'SELECT symbol, analysis_date, prompt_version, generated_at FROM stock_analysis_cache ORDER BY generated_at DESC LIMIT 10;'"
  ```

### 8.5.5 flip 알림 (VAPID 정식 키 교체 후)

다음 날 같은 종목의 consensus.verdict 가 변경되면:
- `stock_consensus_flips` 에 row INSERT (`from_verdict`, `to_verdict`, `detected_date`)
- VAPID 정식 키 있으면 push 알림 도달
- `notified_at` UPDATE

확인:
```bash
ssh gon@192.168.0.5 "docker exec gons-dashboard-postgres psql -U gons -d gons_dashboard -c 'SELECT symbol, from_verdict, to_verdict, detected_at, notified_at FROM stock_consensus_flips ORDER BY detected_at DESC;'"
```

---

## Phase 8 self-check (Definition of Done — spec §8)

- [ ] **DoD 1**: 종목 추가 (Yahoo autocomplete + 수량 + 평단) — Task 8.5.1
- [ ] **DoD 2**: `StockAnalysisCard` 옵션 3 (헤드라인 + 리스트) — Task 8.5.2
- [ ] **DoD 3**: `StockDetailModal` A 레이아웃 (합의 + 페르소나 5 + 차트 + 펀더멘털) — Task 8.5.2
- [ ] **DoD 4**: LLM 탭 모델 override — Task 8.5.2
- [ ] **DoD 5**: cron 자산군 라우팅 + flip push — Task 8.5.3 + 8.5.4 + 8.5.5
- [ ] **DoD 6**: 면책 텍스트 모달 footer — Task 8.5.2
- [ ] **DoD 7**: Edge case UI (LLM 부분 실패 / rate-limit / 데이터 없음) — dogfooding 도중 발견 시 메모
- [x] **DoD 8**: 테스트 — Phase 1~7 의 unit/integration 모두 PASS (CI 통과)
- [x] **CLAUDE.md Gotcha 추가** — §7~§9 영구 기록 완료

---

## 사용자 후속 작업 우선순위

1. **Google OAuth 정식 키 발급** (Task 8.2) — 로그인 안 되어서 다른 모든 dogfooding 차단됨. 최우선.
2. **종목 등록 + widget dogfooding** (Task 8.5.1~8.5.2) — 1회 종목 추가 후 widget 동작 확인.
3. **수동 cron trigger** (Task 8.5.3) — 등록 직후 1회 fire → cache row 확인.
4. **VAPID 정식 키 발급** (선택, 사용자 본인 발급) — push 알림 받고 싶을 때만.
5. **자연 발생 cron 확인** (Task 8.5.4) — 최소 24시간 운영 후 cron 로그 확인 (다음 KST 06:30 또는 16:30).
6. **flip 알림 검증** (Task 8.5.5) — 최소 48시간 운영 + verdict 자연 변동 발생 시.

Phase 8 완료 후 v1.0 ship. backlog (KIS OpenAPI 폴백, 평단 인식 분석, MCP 서버화) 는 v1.1+ 진입.
