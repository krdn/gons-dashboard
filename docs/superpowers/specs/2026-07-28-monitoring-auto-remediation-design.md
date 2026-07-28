# 관제 자동 복구 (auto-remediation) 설계

- 날짜: 2026-07-28
- 상태: 설계 확정 (구현 전)
- 관련: 이슈 #323 (관제), PR #349 (이벤트 동결 수정), PR #350 (포트 허용목록)

## 배경

2026-07-28 관제가 "위험"을 표시해 수동 조사·복구를 수행했다. 미해결 4건은
모두 실제 문제였고, 조사에서 관제 자체의 결함 1건도 드러났다. 이 작업을
사람이 매번 반복하지 않도록 자동화한다.

수동 작업의 단계는 이랬다: 이벤트 조회 → 현장 대조 → 실제/오탐 판정 →
조치 → 배포 → 해소 확인. 이 중 **판정과 조치**가 자동화 대상이다.

### 수동 복구에서 얻은 교훈 (설계 제약의 근거)

두 조치는 "그럴듯했지만 실행했으면 장애를 냈을" 것이다:

1. **Redis 고아 키 삭제** — `ais-dev:` prefix + `XINFO STREAM` 의 `groups=0`
   때문에 폐기 가능한 dev 잔재로 보였다. 그러나 `OBJECT IDLETIME` 페어
   재측정에서 활성 독자가 드러났다 (한 키만 리셋, 대조군은 +26초 정확).
   지웠다면 살아있는 소비자가 깨졌다.
2. **5433 루프백 재바인딩** — `0.0.0.0` 노출이라 보안상 좁혀야 할 것으로
   보였다. 그러나 news 앱들이 `host.docker.internal:5433` 으로 접속하는
   구조여서, 좁혔으면 서비스 전체가 끊겼다.

**공통 교훈: 이름·prefix·관례는 판단 근거가 못 된다.** 자동 조치는 관측된
사실만 조건으로 삼아야 한다. 이 원칙을 §4 안전장치에 강제한다.

### 이벤트 분포 실측 (트리거 설계의 근거)

`monitoring_events` 278건 (2026-07-28 기준):

| source/severity | 건수 | 자동해소 | 평균 지속 |
|---|---|---|---|
| host/warning | 240 | 240 | 0.1h |
| service/warning | 12 | 12 | 0.1h |
| host/critical | 12 | 11 | 16.1h |
| http/critical | 5 | 5 | 4.6h |
| cron/critical | 3 | 3 | 0.1h |
| cron/warning | 3 | 3 | 2.6h |
| ssl/critical | 2 | 2 | 5.0h |
| security/warning | 1 | 1 | 119.1h |

**86%(240건)가 6분 내 스스로 해소된다.** 사람 손이 필요했던 것은 오래 열려
있던 소수다. 따라서 자동화 대상은 *빈도*가 아니라 **지속 시간**으로 고른다.

## 목표 / 비목표

**목표**
- 반복 가능하고 되돌릴 수 있는 조치를 사람 개입 없이 수행
- 모든 시도를 감사 가능하게 기록
- 오탐 조치로 인한 2차 장애를 구조적으로 차단

**비목표**
- systemd 단위 조치 (certbot 등) — 호스트 에이전트가 필요해 범위 외.
  certbot 은 timer 가 하루 2회 재시도하므로 자동화 가치가 낮다.
- 근본 원인 해결 — 자동 조치는 시간을 벌 뿐이다. 반복되면 사람을 부른다.
- 이벤트 판정 로직 변경 — 기존 `judge*` 함수를 그대로 신뢰한다.

## 아키텍처

```
apps/cron/scheduler.js  ──5분──▶  POST /api/cron/auto-remediate
                                          │
                        features/monitoring-remediate/
                          config/policies.ts    정책 선언 (트리거 + 조치 + 제약)
                          lib/selectActions.ts  순수함수: open 이벤트 → 조치 목록
                          lib/guards.ts         순수함수: 안전장치 판정
                          api/executeAction.ts  실행 (container-actions 재사용)
                                          │
                        remediation_attempts (감사 + 쿨다운 근거)
```

기존 `monitoring-*` features 와 같은 위상이다. 판정을 순수 함수로 분리하는
것은 `judgeDatastoreStats` 가 이미 쓰는 패턴으로, DB·docker 없이 테스트할
수 있게 한다.

**권한 경로**: app·cron 컨테이너 모두 `/var/run/docker.sock` 을 마운트하고
있어 호스트 docker 제어가 가능하다. `features/container-actions/` 에
restart/start/stop + `insertAuditLog` 가 이미 구현돼 있어 재사용한다.

## 트리거 정책

open 이벤트가 **최소 지속 시간**을 넘겨야 조치 대상이 된다.

| severity | 최소 지속 |
|---|---|
| critical | 30분 |
| warning | 6시간 |

이 게이트 하나가 자해소되는 240건을 조치 대상에서 제외한다. self-healing 의
흔한 실패는 "이미 끝난 상황에 조치해 새 장애를 만드는 것"인데, 지속 시간
게이트가 그 부류를 구조적으로 차단한다.

## 조치 카탈로그

| 트리거 | 조치 | 실행 경로 | 사전 조건 (실패 시 중단) |
|---|---|---|---|
| 컨테이너 unhealthy·exited 지속 | `restart` | `features/container-actions` 의 `restartContainer` | 제외목록에 없을 것 (postgres 등 상태 보유 서비스) |
| `disk.used_pct` ≥ 85% | dangling 이미지 정리 | `runDocker(ctx, ["image","prune","-f"])` | volume·named image 절대 제외, 1일 1회 |
| redis 사용률 ≥ 임계 + `noeviction` | maxmemory 단계 상향 | `runDocker(ctx, ["exec",target,"redis-cli","CONFIG","SET","maxmemory",N])` | 호스트 가용 메모리 확인 + 절대 상한 캡 + 누적 2회까지 |

각 정책은 `config/policies.ts` 에 선언적으로 정의하고, 사전 조건은 실행
직전에 **실측**으로 확인한다 (선언 시점의 가정을 신뢰하지 않는다).

**실행 권한은 검증됐다**: app 컨테이너에 `/usr/bin/docker` 가 있고
`/var/run/docker.sock` 마운트로 호스트 컨테이너 43개를 실제 조회했다
(2026-07-28 확인). 모든 조치는 기존 `shared/lib/docker/runDocker.ts` 를
경유한다 — 새 권한 경로를 만들지 않는다.

### 인증 — cron 은 `runAction` 을 그대로 호출할 수 없다

`container-actions/api/_runAction.ts` 는 보안 경계 5종을 갖는데, 그 중 앞
두 개가 **사람 세션을 전제**한다:

1. `auth()` 세션 없으면 `UNAUTHORIZED`
2. `ADMIN_EMAILS` allowlist 미포함이면 `FORBIDDEN`

cron 은 `CRON_BEARER_TOKEN` 으로 인증하고 NextAuth 세션이 없다. 따라서
`restartContainer` 를 그대로 부르면 **항상 UNAUTHORIZED 로 실패한다.**

**해결 — 인증 계층과 실행 계층 분리** (경계 우회가 아니라 재구성):

```
runAction()               ← Server Action 진입점. auth() + isAdmin() 검사 후 위임
  └─ executeContainerAction()   ← Zod 검증 + host 조회 + runDocker + 감사 로그
       ↑
auto-remediate cron ────────┘   ← CRON_BEARER_TOKEN 으로 인증된 뒤 직접 호출
```

- 경계 3·4·5(입력 검증, host 검증, 감사 로그)는 **두 경로가 공유**한다.
  이것들은 호출자가 사람이든 시스템이든 똑같이 필요하다.
- 경계 1·2(인증, 인가)는 진입점마다 다르다. 사람은 세션+allowlist,
  cron 은 bearer token 이 그 역할을 한다. **누구도 무인증으로 실행하지
  않는다** — 신뢰 주체가 다를 뿐이다.
- 감사 로그의 actor 는 `system:auto-remediate` 로 기록한다. 사람 조치와
  자동 조치가 로그에서 구분되어야 사후 추적이 가능하다.

`insertAuditLog` 가 시스템 actor 를 받을 수 있는지는 구현 시 확인하고,
못 받으면 그 타입을 확장한다.

### Redis 조치의 한계 — 런타임 전용

`CONFIG SET maxmemory` 는 런타임에만 적용되고 **컨테이너 재시작 시
원복된다.** 영구화하려면 대상 프로젝트의 compose 파일(`command:` 의
`--maxmemory`)을 고쳐야 하는데, 이는 호스트 파일시스템에 있어 대시보드
컨테이너에서 접근할 수 없다.

따라서 이 조치는 **시간을 버는 임시 조치**로 규정하고, 실행 시 별도
이벤트("영구화 필요 — compose 수정")를 발행해 사람이 마무리하게 한다.
자동 조치가 근본 원인을 조용히 덮는 것을 막는 장치다.

## 안전장치

1. **시도 횟수 상한** — 같은 `dedupKey` 에 N회 초과 시 조치를 멈추고
   에스컬레이션 이벤트를 발행한다 (사람 호출).
2. **효과 검증** — 조치 후 다음 사이클에 이벤트가 해소되지 않았으면
   **재시도하지 않고 중단**한다. 같은 조치의 반복은 self-healing 의 대표적
   폭주 경로다.
3. **쿨다운** — 대상별 재조치 금지 시간을 둔다.
4. **kill switch** — `AUTO_REMEDIATE_ENABLED=false` 로 전체 정지.
5. **전량 감사** — 모든 시도를 `remediation_attempts` + `audit_logs` 에
   기록하고, 실행 시 텔레그램 알림을 보낸다.
6. **관측된 사실만 조건으로** — 정책의 사전 조건은 실측값(메모리 사용량,
   healthcheck 상태, 디스크 사용률)만 쓸 수 있다. 이름·prefix·관례를 조건에
   넣지 않는다. 배경 §교훈의 두 사고를 구조적으로 막는 장치다.
7. **원자적 실행권 획득** — 아래 §동시성 참조.

### 동시성 — 원자적 실행권 획득

cron 은 5분 주기인데 조치(특히 컨테이너 재시작)는 그보다 오래 걸릴 수
있다. 앞 사이클이 끝나기 전에 다음 사이클이 같은 이벤트를 집으면 **같은
대상에 조치가 중복 실행**된다. 재시작이 두 번 겹치면 복구 중인 서비스를
다시 죽인다.

기존 `claimEventNotification` 이 알림 이중 발송에 대해 푼 것과 같은 문제이므로
같은 패턴을 쓴다 — **DB 레벨 원자적 claim**:

```sql
-- 같은 dedup_key 로 in-flight 시도는 하나만 존재할 수 있다
CREATE UNIQUE INDEX remediation_in_flight_uq
  ON remediation_attempts (dedup_key) WHERE outcome = 'in_flight';
```

실행 절차는 `recordEvent` 의 INSERT-first 패턴을 미러한다:

1. `outcome='in_flight'` 로 INSERT 를 **먼저** 시도
2. `23505` (unique 위반) → 다른 사이클이 이미 실행 중 → 이번 사이클은 skip
3. 성공하면 실행권을 얻은 것 — 조치 수행 후 `executed`/`failed` 로 UPDATE

SELECT-then-INSERT 로 확인하면 두 사이클이 같은 틈에 통과할 수 있다.
INSERT 를 먼저 시도해 DB 가 중재하게 한다.

**고아 in-flight 처리**: 프로세스가 조치 도중 죽으면 `in_flight` row 가
남아 해당 대상이 영구히 잠긴다. 사이클 시작 시 일정 시간(조치 최대
소요시간의 배수)이 지난 `in_flight` 를 `failed` 로 정리한다.

## 데이터 모델

`remediation_attempts` (신규):

| 컬럼 | 용도 |
|---|---|
| `id` | PK |
| `event_id` | 대상 `monitoring_events` FK |
| `dedup_key` | 시도 횟수·쿨다운 집계 키 |
| `policy` | 적용된 정책 식별자 |
| `action` | 실행한 조치 |
| `dry_run` | dry-run 여부 |
| `outcome` | `in_flight` / `executed` / `skipped` / `failed` |
| `reason` | skip·실패 사유 (사전 조건 불충족 등) |
| `detail` | 실측값 스냅샷 (판단 근거 보존) |
| `attempted_at` | 시각 |

`detail` 에 판단 근거를 남기는 것이 중요하다. 나중에 오탐을 분석할 때
"무엇을 보고 그렇게 판단했는가"가 남아 있어야 한다.

## 롤아웃

**Phase 1 — dry-run 전용.** 실행 없이 "무엇을 했을 것인지"만 기록한다.
1~2주 관찰해 오탐을 확인한다.

**Phase 2 — 점진 활성.** 로그가 깨끗한 조치부터 하나씩 실행 모드로 전환한다.

처음부터 실행 모드로 켜지 않는 이유는 배경 §교훈에 있다. 그럴듯한 조치
두 개가 실제로는 서비스를 깨뜨리는 것이었고, dry-run 은 그 판정을 무해하게
검증하는 유일한 방법이다.

## 테스트

- `selectActions` / `guards` — 순수 함수 unit 테스트.
  `tests/unit/judgeDatastoreStats.test.ts` 패턴을 따른다.
- 실행 경로 — docker 호출을 mock 한 통합 테스트.
- 회귀 케이스로 배경 §교훈의 두 사고를 넣는다: 사전 조건이 불충족일 때
  조치가 `skipped` 되는지 검증.

## 열린 질문

- 시도 횟수 상한 N, 쿨다운 시간의 구체값은 Phase 1 관찰 후 확정한다.
  지금 정하면 근거 없는 상수가 된다.
- 재시작 제외목록의 초기 구성은 구현 시 운영 컨테이너 실측으로 채운다.
