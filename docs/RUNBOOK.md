# Runbook

운영 절차 모음. dogfooding 단계에서는 모든 배포·복구 명령을 본인이 실행한다.

## 인프라 요약

| 항목 | 값 |
|------|-----|
| 호스트 | 192.168.0.5 (docker context: `home-server`) |
| 운영 URL | https://gons.krdn.kr (외부 도메인 + HTTPS, LAN: http://192.168.0.5:3020) |
| 컴포즈 위치 | 로컬 `/home/gon/projects/gon/gons-dashboard/docker-compose.yml` |
| 원격 daemon 제어 | `docker --context home-server`, alias `dserver`, `dcserver` |

## 컨테이너

| 서비스 | 이미지 | 포트 |
|--------|--------|------|
| postgres | postgres:16-alpine | 5440 → 5432 |
| redis | redis:7-alpine | 6390 → 6379 |
| app | ghcr.io/krdn/gons-dashboard:latest | 3020 |
| cron | ghcr.io/krdn/gons-dashboard-cron:latest | (내부) |

## 배포 (정상 경로)

```bash
# 0. main에 push → GHA가 이미지 빌드/푸시 (~5분)
#    https://github.com/krdn/gons-dashboard/actions 에서 확인
git push

# 1. 새 이미지 pull
dcserver pull app cron

# 2. 무중단 재시작
dcserver up -d app cron

curl -sS http://192.168.0.5:3020/api/health  # LAN 직접
curl -sS https://gons.krdn.kr/api/health      # 도메인 경유
```

## 첫 배포 (one-time)

```bash
# 1. GHCR 패키지 가시성 확인 (private면 home-server에서 PAT 로그인 필요)
#    https://github.com/users/krdn/packages → gons-dashboard, gons-dashboard-cron
#    → Package settings → Change visibility → Public  (권장)
#    또는 home-server에서: docker login ghcr.io -u krdn -p <PAT_with_read:packages>

# 2. Google OAuth Console에 운영 redirect URI 등록
#    https://console.cloud.google.com/apis/credentials
#    Authorized redirect URIs에 추가:
#      https://gons.krdn.kr/api/auth/callback/google
#    (Google은 private IP redirect URI를 거부하므로 도메인 필수)

# 3. 첫 pull + up
dcserver pull
dcserver up -d

# 4. 로그 확인
dcserver logs -f app
```

## 롤백

```bash
# 특정 SHA로 롤백
APP_IMAGE_TAG=sha-<full_sha> dcserver up -d app cron
```

## 시크릿 회전

### CRON_BEARER_TOKEN

```bash
# 1. 새 토큰 생성
openssl rand -hex 32

# 2. .env의 CRON_BEARER_TOKEN 업데이트
# 3. app + cron 동시 재시작 (둘 다 같은 토큰을 봐야 함)
dcserver up -d app cron --force-recreate
```

### NEXTAUTH_SECRET

```bash
# 1. 새 시크릿 생성
openssl rand -base64 32

# 2. .env 업데이트 → app 재시작
# 3. 모든 기존 세션 무효화됨 → 재로그인 필요
dcserver up -d app --force-recreate
```

## OAuth 강제 재인증

scope 변경, refresh token 손상 시:

```bash
# 1. dry-run으로 현재 상태 확인
pnpm exec tsx src/scripts/_dryrun-oauth-scope.ts

# 2. 실제 reset
pnpm exec tsx src/scripts/fix-oauth-scope.ts

# 3. https://gons.krdn.kr 에서 재로그인
```

## DB 마이그

```bash
# 1. 스키마 변경 후 마이그레이션 파일 생성
pnpm db:generate

# 2. 운영 DB 적용 (DATABASE_URL이 운영을 가리키는 .env 사용)
pnpm db:migrate

# 3. drizzle/ 디렉토리는 커밋
git add drizzle/
```

## 컨테이너 별 디버깅

### app 로그
```bash
dcserver logs -f app | grep -E "ERROR|WARN"
```

### postgres 접속
```bash
dserver exec gons-dashboard-postgres psql -U gons -d gons_dashboard
```

### cron 작업 확인
```bash
dcserver logs cron | tail -50
```

### redis 점검
```bash
dserver exec gons-dashboard-redis redis-cli ping
```

## 자주 발생하는 이슈

### `unauthorized` on `dcserver pull`
GHCR 패키지가 private. 위의 "첫 배포 #1" 참조.

### OAuth 콜백 실패
`NEXTAUTH_URL`과 Google OAuth Console redirect URI 불일치. 둘 다 `https://gons.krdn.kr` 기반이어야 함. Google은 private IP(192.168.x.x) redirect URI를 `device_id required` 에러로 거부하므로 LAN URL은 사용 불가.

### cron이 호출 안 됨
- TZ=Asia/Seoul 확인: `dcserver exec cron date`
- CRON_BEARER_TOKEN 일치 확인 (app, cron 양쪽 동일)
- app health: `curl -sS https://gons.krdn.kr/api/health`

## v0.1 중요 이메일 위젯 검증

배포 후 dogfooding 1주일 체크리스트. E2E 테스트 인프라가 없으므로 수동 검증으로 대체.

### 동작 검증 (배포 후 1일 이내)
- [ ] cron이 매시간 `important_emails`에 행 INSERT (`SELECT count(*), category FROM important_emails GROUP BY category;`)
- [ ] 대시보드 위젯에 "최근 중요 메일" 섹션 노출 (https://gons.krdn.kr)
- [ ] 카테고리 4종 모두 한 번 이상 등장 — money / security / schedule / notice
- [ ] "Gmail" 버튼 클릭 → 새 탭에서 해당 스레드 열림
- [ ] "읽음" 클릭 → Gmail UNREAD 라벨 제거됨 + 위젯에서 사라짐 (revalidate)
- [ ] "보관" 클릭 → Gmail INBOX 라벨 제거됨 + 위젯에서 사라짐

### D6 답장 우선 정책 검증
- [ ] 같은 스레드가 reply_needed에 활성 상태면 important 위젯에서 숨김
- [ ] reply_needed "답장함" 처리 후 important에 등장

### 7일 윈도 검증 (8일 후)
- [ ] `classified_at < NOW() - 7d` 행은 위젯에 노출 안 됨

### 비용 검증 (1주일)
- [ ] 일 LLM 비용 < $0.10 (proxy 로그 또는 Anthropic 콘솔)
- [ ] 메일링 컷률 30-50% (`important_skipped_mailing_list_total` 메트릭이 있으면)

### 데이터 수집 (Eval CI 준비)
- [ ] `(category, importance, summary, classifier_version, read_at, archived_at)` 페어 자동 누적 확인
- [ ] 30일 누적 후 v0.2의 GitHub Actions eval CI 가능

### DB 쿼리 (수동 점검)
```sql
-- 카테고리별 분류 결과
SELECT category, importance, count(*) FROM important_emails GROUP BY 1, 2 ORDER BY 1;

-- 최근 24h 분류 (cron 정상 동작 확인)
SELECT count(*) FROM important_emails WHERE classified_at > NOW() - INTERVAL '24 hours';

-- 처리율 (read/archive 비율)
SELECT
  count(*) AS total,
  count(read_at) AS read_count,
  count(archived_at) AS archived_count
FROM important_emails
WHERE classified_at > NOW() - INTERVAL '7 days';
```

### 수동 재분류 트리거 (`POST /api/admin/reclassify`)

`syncInbox`는 Gmail history.list가 새 메시지 0건을 반환하면 분류 분기를 통째로 skip한다 (멱등 설계). 그래서 **모델 ID/프롬프트 수정 후 새 메일이 들어오기 전까지 LLM fix가 검증되지 않는 사각**이 생긴다. 이 엔드포인트는 그 사각을 메우기 위한 운영용 트리거.

- **인증**: `CRON_BEARER_TOKEN`(cron이 쓰는 것과 동일).
- **입력**:
  - `email` (required): users.email 매칭.
  - `hoursBack` (optional, 기본 24, 1~168): 윈도우.
  - `force` (optional, 기본 false): true면 해당 user × 윈도우의 `important_emails` 행을 먼저 DELETE하고 재분류 (idempotent skip 우회). reply_needed는 force와 무관하게 항상 멱등 재실행됨.
- **응답**: `{ kind, threadsInWindow, forcedDeleted, classified, skipped, importantOutcomes, importantConsidered }`.

```bash
# 예: 본인 24h 메일 강제 재분류 (배포 직후 LLM fix 검증)
TOKEN=$(grep ^CRON_BEARER_TOKEN /home/gon/projects/gon/gons-dashboard/.env | cut -d= -f2)
curl -sS -X POST https://gons.krdn.kr/api/admin/reclassify \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"krdn.net@gmail.com","hoursBack":24,"force":true}' | jq
```

LAN에서 직접:
```bash
dserver exec gons-dashboard-app sh -c '
  curl -sS -X POST http://localhost:3020/api/admin/reclassify \
    -H "Authorization: Bearer $CRON_BEARER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"krdn.net@gmail.com\",\"hoursBack\":24,\"force\":true}"
' | jq
```

응답 해석:
- `importantOutcomes.classified > 0` — LLM 정상 작동.
- `importantOutcomes["skipped-none"]` 만 큼 → LLM이 "important 아님" 판정한 메일 수.
- `importantOutcomes["skipped-mailing-list"]` → 메일링 시그널로 컷.
- `importantOutcomes["skipped-llm-error"]` → LLM API 실패. 직후 `dserver logs gons-dashboard-app | grep classify-important` 확인.
- `importantOutcomes["skipped-already"]` (force=false 시) → 이미 분류 완료. force=true 줘서 재실행.

**주의**:
- 운영자 본인용 운영 도구다. cron Bearer가 admin grade이므로 외부 노출 금지(현재 NEXTAUTH_URL 기반 reverse proxy 뒤에 있다).
- LLM 비용을 발생시킨다. force=true는 윈도우 안의 모든 스레드에 LLM 호출 → 본인 1명·24h·~수십 통 기준 $0.01 미만이지만, 168h × force=true는 자제.

## v0.1 서버 인프라 모니터

### 초기 셋업 (one-time)

```bash
# 1. .env에 서버 인프라용 환경변수 추가
#    DOCKER_DEFAULT_CONTEXT=home-server
#    DOCKER_CMD_TIMEOUT_MS=10000
#    ADMIN_EMAILS=krdn.net@gmail.com (콤마 구분)

# 2. Docker context 등록 확인 (이미 있어야 함)
docker context ls | grep home-server

# 3. 마이그레이션 적용
pnpm db:migrate

# 4. 호스트 seed (idempotent)
pnpm db:seed:hosts
# → "✅ seeded host: { id: '<uuid>', name: 'home-server' }"

# 5. 앱 재시작 후 / 페이지에서 ServerOverviewCard가 보이는지 확인
```

### 운영 사용

- **메인 페이지 `/`**: ServerOverviewCard에 호스트별 프로젝트 그룹 요약 표시.
- **호스트 상세 `/servers/home-server`**: project별 컨테이너 리스트 + 액션 버튼 + 최근 audit log 5건.
- **권한**: read는 인증된 사용자 누구나, restart/start/stop은 `ADMIN_EMAILS`에 포함된 이메일만.
- 각 액션은 `audit_logs` 테이블에 status(`success`|`failed`) + `duration_ms` + 사용자 이메일 + 에러 메시지(500자 cap)로 기록됨.

### Dogfooding 체크리스트 (배포 후 1주일)

E2E 테스트가 v0.2로 deferred되어 수동 검증으로 대체.

#### 메인 페이지 표시 (배포 후 1일 이내)
- [ ] `/` 접속 시 ServerOverviewCard 노출
- [ ] 호스트 카드에 home-server (192.168.0.5) + 마지막 갱신 시각 표시
- [ ] compose project별 그룹화 동작 (news-prod, ais-prod, n8n 등 라벨대로)
- [ ] 라벨 없는 컨테이너가 standalone 그룹에 모임
- [ ] 모든 컨테이너 정상 시 ✓, 1개 이상 비정상 시 ⚠ 배지

#### 호스트 상세 페이지
- [ ] `/servers/home-server` 페이지 정상 로드
- [ ] HostBadge가 daemon 정상이면 emerald, 끊기면 rose로 표시
- [ ] Project 섹션 헤더에 displayName + 카운트 (예: "4/4 running") 표시
- [ ] 컨테이너 행에 status badge + 이름 + statusText + 포트 표시
- [ ] 페이지 하단 "최근 액션 5건" 패널이 audit_logs에서 로드됨

#### 권한 / 액션
- [ ] admin 이메일로 로그인했을 때만 restart/start/stop 버튼 노출
- [ ] 비admin 이메일로 로그인했을 때 ActionButtons 숨김
- [ ] restart 버튼 클릭 → `window.confirm` 다이얼로그 → 확인 시 컨테이너 재시작
- [ ] 액션 진행 중 버튼 disabled + spinner
- [ ] 성공 시 `✓ restart 성공` 메시지 + audit_logs에 status=success 행 추가
- [ ] start 버튼은 exited/paused/dead/created 상태에서만 노출
- [ ] stop 버튼은 running/restarting 상태에서만 노출

#### 에러 경로
- [ ] Docker daemon이 다운됐을 때 — 메인 페이지에 rose 배너 "Docker 연결 불가" + 마지막 시도 시각 표시
- [ ] 잘못된 hostName으로 `/servers/...` 접속 → 404
- [ ] 인증 안 된 상태에서 액션 호출 시 → Server Action이 UNAUTHORIZED 반환 (토스트로 노출)
- [ ] 비admin이 직접 Server Action 호출 시도 시 → FORBIDDEN

#### DB 검증
```sql
-- 등록된 호스트
SELECT * FROM hosts;

-- 자동 생성된 projects (compose label 발견 시 lazy upsert)
SELECT compose_project, display_name, is_pinned, is_hidden, updated_at FROM projects ORDER BY compose_project;

-- 최근 audit log
SELECT created_at, action, container_name, status, duration_ms, user_email, error_message
FROM audit_logs ORDER BY created_at DESC LIMIT 20;

-- 액션별 성공률
SELECT action, status, count(*) FROM audit_logs GROUP BY 1, 2 ORDER BY 1, 2;
```

### 자주 발생하는 이슈

- **`등록된 호스트가 없습니다` 메시지**: `pnpm db:seed:hosts` 실행 안 됨. RUNBOOK 초기 셋업 #4 참조.
- **`Docker 연결 불가` 배너**: docker context 미설정 또는 SSH 인증 실패. `docker --context home-server version`으로 직접 검증.
- **액션 버튼 안 보임**: 비admin 이메일로 로그인했거나 ADMIN_EMAILS 미설정. `.env` 확인 + 앱 재시작.
- **모든 컨테이너가 standalone 그룹**: compose 미사용 또는 `com.docker.compose.project` 라벨 누락. `docker inspect <id> --format '{{.Config.Labels}}'`로 라벨 확인. compose 사용 권장.
- **projects 테이블의 displayName이 compose project 이름과 동일**: lazy upsert 시 default가 composeProject 그대로 들어감. UI 추가 전까진 `UPDATE projects SET display_name = '뉴스 서비스 (운영)' WHERE compose_project = 'news-prod';` 같은 수동 SQL로 갱신.
