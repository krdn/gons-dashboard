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
