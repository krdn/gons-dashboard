# 실시간 관제 Phase 4 — DB 심층지표·미노출 승격·LLM 비용 통합 (이슈 #323)

> 작성일: 2026-07-20 · 선행: Phase 1(#324) / Phase 2(#325·#326) / Phase 3(#328·#329) 운영 가동 중
> 분할: **PR-A = §J 데이터스토어 심층지표**(호스트 배포물 갱신 동반) → **PR-B = §K LLM 비용 통합**
>
> ⚠️ **범위 재구성 근거 (GitHub 장애)**: 작성 시점에 GitHub API 가 전면 503 이라
> 이슈 #323 본문을 읽지 못했다. 아래 범위는 **Phase 3 spec 의 이관 명시 3곳**
> (L227 연결 수·DB 크기 / L285 미노출 2건 healthcheck 승격 / L295 LLM 비용 통합)
> 으로 재구성했다. 이슈 본문에 Phase 4 로 명시된 다른 항목이 있으면 추가 편입할 것.

---

## 0. 착수 전 실측 — 설계를 바꾼 사실

Phase 2 의 D-Bus 사고, Phase 3 의 `NoNewPrivileges` 사고를 되풀이하지 않기 위해
**설계 이전에** 운영 서버(192.168.0.5)에서 채널 프로브를 먼저 돌렸다.

### 0-1. docker exec 채널이 12개 인스턴스 **전부**를 관측한다

Phase 3 는 네트워크(TCP) 채널이라 포트 미노출 2건이 영구 `unknown` 이었다.
docker exec 는 **네트워크 노출과 무관**하므로 그 2건이 나머지와 동일하게 다뤄진다.

| 컨테이너 | 관측 결과 (실측) |
|---|---|
| gons-dashboard-postgres | conns=14 max=100 size=68.5MB |
| sms-insights-postgres | conns=6 max=100 size=8.0MB ← **Phase 3 에서 영구 unknown 이던 것** |
| ais-prod-postgres | conns=6 size=699.7MB |
| n8n-postgres | conns=8 max=200 size=46.4MB |
| voice-postgres | conns=7 max=100 size=8.2MB |
| ais-postgres | conns=7 max=100 size=12.8MB |
| krdn-timescaledb | conns=11 max=100 size=10.8MB |
| gons-dashboard-redis | clients=1 maxclients=10000 mem=1.11MB |
| ais-prod-redis | clients=34 mem=**799.9MiB** ← 타 인스턴스의 400배, 관제 가치 즉시 증명 |
| news-prod-redis | clients=15 mem=2.05MB |
| voice-redis | clients=2 mem=1.04MB |
| n8n-redis | clients=20 mem=1.96MB ← **Phase 3 에서 영구 unknown 이던 것** |

→ **Item 1(심층지표)과 Item 2(미노출 승격)는 별개 작업이 아니다.**
하나의 수집기가 동시에 해결한다. 이것이 docker exec 채널 선택의 실질적 이득이다.

### 0-2. ⚠️ 자격증명을 **새로 만들지 않는다** — 컨테이너 내부 trust 인증 이용

Phase 3 는 "자격증명 없이 liveness 만"을 원칙으로 세웠다. Phase 4 는 그 원칙을
**깨지 않는다**: 새 DB role 도, 에이전트 env 의 비밀번호도 도입하지 않는다.

컨테이너 안에서는 로컬 소켓 `trust` 인증이 걸려 있어 (Gotcha #8 의 `pg_hba.conf
local all all trust` 와 동일 구조) **비밀번호 없이** 조회된다. 필요한 것은
계정이 아니라 *컨테이너에 들어갈 권한*이다.

**사용자·DB 이름은 하드코딩하지 않고 컨테이너 env 에서 발견한다** — 실측상 전부 다르다:

```
gons-dashboard-postgres  POSTGRES_USER=gons   POSTGRES_DB=gons_dashboard
sms-insights-postgres    POSTGRES_USER=sms    POSTGRES_DB=sms_insights
ais-prod-postgres        POSTGRES_USER=ais    POSTGRES_DB=ai_signalcraft
n8n-postgres             POSTGRES_USER=n8n    POSTGRES_DB=n8n
voice-postgres           POSTGRES_USER=voice  POSTGRES_DB=voice_recognition
ais-postgres             (unset → postgres)   POSTGRES_DB=ai_afterschool
krdn-timescaledb         (unset → postgres)   POSTGRES_DB=krdn_fx
```

⚠️ `psql -U <user>` 만 주면 **user 와 같은 이름의 DB** 에 접속을 시도해
`FATAL: database "gons" does not exist` 로 실패한다(실측). `-d <POSTGRES_DB>` 필수.
env 미설정 시 기본값은 `postgres`/`postgres`.

### 0-3. ⚠️ 수집 주체는 에이전트가 아니라 **기존 root collector** 다

```
gons-agent → docker ps
  = permission denied … unix:///var/run/docker.sock   (실측)
docker 그룹 구성원 = gon 뿐
```

에이전트에 `docker` 그룹을 부여하는 안은 **폐기**한다 — docker 소켓 접근은
사실상 root 등가(임의 컨테이너를 특권·호스트 마운트로 기동 가능)라
Phase 3 가 sudoers 를 폐기한 것과 **정확히 같은 이유**로 최소권한 위반이다.

→ Phase 3 PR-A 가 배포한 **`gons-security-collect` 를 재사용**한다. 이미
운영에서 `enabled` 상태로 5분 타이머로 돌고 있는(실측 확인) root oneshot 이며,
`/run/gons-monitoring/` 원자적 쓰기 + 에이전트 읽기 경로가 검증돼 있다.
신규 유닛·타이머·배포물을 만들지 않는다 (호스트 배포물 증가는 Phase 3 함정 #5).

**유닛 옵션 호환성은 실증 완료** — Phase 3 §0-1 의 규율대로 셸이 아닌
*유닛 환경*에서 확인했다. collector 의 실제 옵션 전부를 건 채:

```
systemd-run -p Type=oneshot -p User=root -p ProtectHome=yes \
  -p ProtectSystem=strict -p IPAddressDeny=any \
  -p RuntimeDirectory=gons-monitoring -p RuntimeDirectoryPreserve=yes \
  → docker exec … psql …  = "12,68762647"  (exit 0) ✅
```

`IPAddressDeny=any` 는 docker 소켓이 **유닉스 소켓**이라 영향이 없고,
`ProtectSystem=strict` 도 `/var/run/docker.sock` 접근을 막지 않는다.
→ **유닛 옵션 변경 없이 collector 를 그대로 확장**하면 된다.

### 0-4. ⚠️ psql WARNING 은 stdout 을 오염시키지 않는다 (실측)

`ais-prod-postgres` 는 collation version mismatch WARNING 을 내지만
`2>/dev/null` 로 걸러진 stdout 은 `6,699694103` 로 **정상 파싱된다**(exit 0).
→ stderr 를 버리고 stdout 만 파싱하는 기존 규약 유지. 단 **exit status 를
변환 전에 확인**하는 Phase 3 규칙은 그대로 적용한다.

---

## PR-A — §J 데이터스토어 심층지표 + 미노출 승격

### A-1. 수집 (collector 확장)

`gons-security-collect.sh` 에 `datastores` 섹션을 추가한다. 대상 목록은
**컨테이너 이름**이 필요하므로 `instances.ts` 에 `container` 필드를 신설한다(A-3).

컨테이너당 실행 (**전부 `timeout 5`**, exit status 를 변환 전 확인):

| kind | 명령 |
|---|---|
| `pg` | `docker exec <c> psql -U <env:POSTGRES_USER> -d <env:POSTGRES_DB> -tAF, -c "SELECT (SELECT count(*) FROM pg_stat_activity), (SELECT setting FROM pg_settings WHERE name='max_connections'), pg_database_size(current_database())"` |
| `redis` | `docker exec <c> redis-cli INFO` → `connected_clients` / `maxclients` / `used_memory` 추출 |

user·db 는 `docker inspect --format '{{range .Config.Env}}…'` 로 **런타임 발견**
(0-2 참조). 발견 실패 시 `postgres`/`postgres` 폴백.

payload (Phase 3 §A-2 의 `observed` 판별 유니온 규약 그대로):

```jsonc
"datastoreStats": [
  { "kind":"pg","target":"gons-dashboard","observed":true,
    "conns":14,"maxConns":100,"sizeBytes":68582423 },
  { "kind":"redis","target":"ais-prod","observed":true,
    "conns":34,"maxConns":10000,"memBytes":838751520 },
  { "kind":"pg","target":"sms-insights","observed":false,"reason":"container-missing" }
]
```

- **빈 출력·비수치 응답은 `observed:false`** — Phase 2 0바이트 로그 오탐 방지.
- Redis `maxclients:10000` 은 사실상 무제한이므로 **비율 판정에서 제외**(A-2).

### A-2. 판정 (`judgeDatastoreStats.ts` — 순수 함수)

Phase 3 `judgeDatastores.ts` 를 미러하되 **`instances.ts` 기준으로 순회**하고
`(kind, target)` 복합키로 payload 를 조회한다(같은 이름이 PG·Redis 양쪽에 존재).

| 상황 | 판정 |
|---|---|
| `observed:false` | unknown (reason 노출) |
| payload 에 `(kind,target)` 없음 | unknown (`not-reported`) |
| PG `conns / maxConns` ≥ 0.9 | **critical** (연결 고갈 임박 — 앱 장애 직결) |
| PG `conns / maxConns` ≥ 0.75 | warning |
| Redis `memBytes` ≥ **512MiB** | warning (절대 임계 — `maxclients` 는 무의미) |
| 그 외 | ok |

**임계값은 상수로 분리**(`config/thresholds.ts`), magic number 금지.

⚠️ **Redis 임계를 1GiB 가 아니라 512MiB 로 잡은 이유**: 실측 `ais-prod-redis`
= 838,751,520B = **799.9MiB 로 1GiB 에 미달**한다. 1GiB 로 두면 현재 유일한
이상 인스턴스가 ok 로 판정돼 이 지표가 아무것도 잡지 못한 채 배포된다
(초안이 실제로 이 모순을 담고 있었다 — 산술 검산으로 발견).
512MiB 는 나머지 4개 인스턴스(1~2MiB)와 3자릿수 떨어져 있어 오탐 여지도 없다.

⚠️ **DB 크기는 판정하지 않는다 — 기록만 한다.** 정상 증가와 이상 증가를
1회 관측으로 구분할 수 없다(증가율이 필요). 임의 절대 임계는 오탐만 만든다.
추세 기반 판정은 **다운샘플(5분 집계, Phase 1 spec L32 에서 이미 Phase 4 후보로
언급) 도입 이후**로 미룬다 — 이번 범위 밖.

`ais-prod-redis` 799.9MiB 는 위 규칙에서 즉시 warning 이 된다(의도된 첫 실적).

### A-3. 미노출 2건 승격 — `instances.ts` 확장

```ts
export interface DatastoreInstance {
  kind: "pg" | "redis";
  target: string;
  /** TCP liveness 용(Phase 3). 미노출이면 undefined. */
  port?: number;
  /** docker exec 심층지표 용(Phase 4). 컨테이너 이름. */
  container: string;
}
```

`sms-insights`·`n8n` 은 `port` 없이 `container` 만 갖는다.

⚠️ **여기서 liveness 를 unknown 으로 남기면 "승격"이 아니다.** docker exec 로
`conns=6, size=8MB` 를 받아온 인스턴스를 liveness 만 "관측 공백"으로 표시하는 것은
**같은 행 안에서 자기모순**이다 — 살아있지 않으면 그 수치가 나올 수 없다.
그대로 두면 L285 의 "healthcheck 승격"(= 미관측 상태 해소)이 이름만 남고
실제로는 여전히 반쪽 unknown 으로 보인다.

→ **심층지표 수집 성공을 liveness 의 증거로 승격한다.**
`judgeDatastores`(Phase 3, TCP) 가 `not-exposed` 로 unknown 을 낼 때,
같은 `(kind,target)` 의 `datastoreStats` 가 `observed:true` 면 **ok 로 대체**하고
사유를 `via-docker-exec` 로 남긴다(관측 경로를 숨기지 않는다).

- TCP 노출 10건: 기존 경로 그대로 — 판정 변화 없음.
- 미노출 2건: `not-exposed`(영구 unknown) → **ok(via-docker-exec)**.
- 양쪽 다 실패: unknown 유지 — 관측 공백을 정상으로 위장하지 않는다는 원칙은 불변.

Phase 3 의 `not-exposed` 라벨은 **폴백 경로마저 실패한 경우**에만 남는다.

> 판정의 단일 소스가 `instances.ts` 라는 Phase 3 규약은 유지. 단 `container` 는
> **에이전트 env 로 넘기지 않는다** — collector 가 `docker ps` 로 실재를 확인하므로
> `DATASTORE_SPECS` 의 이중 소스 드리프트 문제를 여기서는 재현하지 않는다.

### A-4. 결선·표시

- 결선: `ingestChecks` 에서 `judgeDatastoreStats()` 를 추가 호출.
  신규 kind 는 만들지 않고 **기존 `pg`/`redis` kind 의 `detail` 을 확장**한다 —
  kind 를 늘리면 `CheckKind` 공개 타입 7곳(Phase 3 §0-3) 을 또 건드려야 하고
  보드가 같은 인스턴스를 두 줄로 표시하게 된다.
- 표시: 기존 `DatastoreBoard.tsx` 의 각 행에 `14/100 · 68.5MB` 형태로 병기.
  **새 보드를 만들지 않는다**(§2 Simplicity).
- `detail` 에 수치를 실으려면 Phase 3 가 확장한 `string|number|boolean|string[]`
  유니온으로 충분 — **타입 변경 불필요**.

---

## PR-B — §K LLM 비용 통합

### B-1. 문제

Phase 3 §B-2 가 위젯을 "사주 한정"으로 명시 제한한 근본 원인:
`llm_spend_log` 에 INSERT 하는 경로가 `logSajuSpend` 뿐이다.

실측 호출부 — `logLlmSpend` 는 **DB 에 쓰지 않고 구조화 로그만** 남긴다:

| 호출부 | kind |
|---|---|
| `shared/lib/llm/classify-thread.ts:75` | `reply-classify` |
| `shared/lib/llm/classify-important.ts:79` | `important-classify` |
| `shared/lib/llm/draft-reply.ts:126` | `reply-draft` |
| `entities/memo/api/classifyMemo.ts:73` | `memo-classify` |

→ **`shared/lib/llm/anthropic.ts:25` 의 `logLlmSpend` 단 한 곳**을 DB 기록으로
바꾸면 4개 호출부가 전부 커버된다. 호출부는 수정하지 않는다.

### B-2. ⚠️ 최대 함정 — sync → async 시그니처 변경 금지

`logLlmSpend` 는 현재 **동기 함수**이고, `anthropic.test.ts` 가
"undefined/null/{} 를 줘도 **throw 하지 않는다**"를 명시적으로 보장한다
(best-effort 관측성 계약). DB INSERT 는 비동기다.

**시그니처를 `Promise` 로 바꾸면**: 4개 호출부가 전부 `await` 를 요구하게 되고,
빠뜨린 곳은 **부동 Promise(floating promise)** 가 되어 unhandled rejection 으로
요청을 죽인다 — 관측성 코드가 본 기능을 깨뜨리는 최악의 회귀다.

→ **동기 시그니처를 유지**하고 내부에서 fire-and-forget 하되 **반드시 catch 를 붙인다**:

```ts
void recordSpend(...).catch((e) => logger.warn({ err: e }, "llm spend 기록 실패"));
```

기존 "throw 하지 않는다" 테스트 3건이 이 계약의 회귀 가드로 그대로 살아남는다.
**비용 기록 실패가 LLM 응답을 실패시켜서는 안 된다** — best-effort 원칙 유지.

### B-3. 단가 산정

`logSajuSpend` 경로는 이미 KRW 를 계산한다. `logLlmSpend` 호출부는 Haiku 중심이라
**모델별 단가표가 필요**하다. 기존 사주 단가 계산 로직을 `shared/lib/llm/pricing.ts`
로 추출해 양쪽이 공유한다(DRY). 미등록 모델은 **KRW=0 이 아니라 `null`** 로 기록 —
0 은 "무료"로 읽혀 비용을 조용히 누락시킨다.

### B-4. 위젯 범위 정정

`entities/monitoring/api/llmSpend.ts:4` 의 "사주뿐" 주석과 위젯 제목·툴팁의
범위 한정 문구를 **함께** 제거한다. 주석만 남으면 다음 사람이 또 오독한다.

KST 일/월 경계는 Phase 3 가 분리한 `shared/lib/kst-range` 를 그대로 쓴다.

**마이그레이션**: `llm_spend_log` 스키마 변경은 불필요(기존 컬럼으로 충분).
단 `krw` 를 nullable 로 바꾼다면 물리 마이그레이션 필요 — CLAUDE.md 규약대로
**운영 DB 는 psql BEGIN/COMMIT 수동 선적용 후 이미지 배포**.

---

## 3. 함정 (Phase 1~3 에서 학습한 것 + 신규)

1. **셸 프로브 ≠ 유닛 환경** — collector 유닛에서 docker.sock 접근을
   `systemd-run` 으로 실증한 뒤 배포할 것(0-3). Phase 2·3 사고와 같은 구조.
2. **오탐보다 무이벤트** — 관측 실패는 `unknown`, verdict row 는 항상 생성.
3. **에이전트에 docker 그룹 부여 금지** — root 등가 권한(0-3).
4. **sync → async 변경 금지** — 부동 Promise 회귀(B-2).
5. **kind 를 새로 만들지 말 것** — `CheckKind` 7곳 확장 + 보드 중복 행(A-4).
6. **DB 크기로 판정하지 말 것** — 추세 없이는 오탐만 만든다(A-2).
7. `psql -U` 만으로는 접속 실패 — `-d` 필수(0-2).

## 4. 검증

- `pnpm typecheck && pnpm lint && pnpm test`
  (신규 순수 함수 단위 테스트: 비율 임계 경계값, `observed:false` → unknown,
  `(kind,target)` 복합키 오매칭 방지, **`logLlmSpend` 가 여전히 throw 하지 않음**)
- `cd apps/dashboard && pnpm build` — features barrel seam 회귀 방지(Gotcha #7)
- 호스트: `systemd-run` 으로 collector 유닛 옵션 하에 docker exec 성공 실증 →
  collector 1회 실행 → `/run/gons-monitoring/security.json` 에 `datastoreStats`
  12건이 실리는지 + **미노출 2건이 `observed:true` 로 바뀌었는지** 확인
- 배포 후 `/monitoring` 데이터스토어 보드에서:
  ① 각 행에 수치가 병기되는지
  ② `ais-prod-redis`(799.9MiB ≥ 512MiB) 가 **warning** 으로 뜨는지
  ③ `sms-insights`·`n8n` 이 unknown 을 벗고 **ok(via-docker-exec)** 로 바뀌는지
