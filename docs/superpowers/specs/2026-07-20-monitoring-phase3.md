# 실시간 관제 Phase 3 — 보안·DB·AI (이슈 #323 §H·§G·§I)

> 작성일: 2026-07-20 · 선행: Phase 1(PR #324) / Phase 2(PR #325·#326) 운영 가동 중
> 분할: **PR-A = §H 보안** (권한 작업 동반) → **PR-B = §G DB/Redis + §I LLM 비용**
> rev3 — Codex 리뷰 2회(8건 + 5건) 반영, systemd 옵션은 운영 서버에서 실증 (2026-07-20)

---

## 0. 착수 전 실측 — 설계를 바꾼 사실

Phase 2 의 D-Bus 사고([[dynamicuser-dbus-systemctl-blocked]])를 되풀이하지 않기 위해
**설계 이전에** 운영 서버(192.168.0.5)에서 `gons-agent` 계정으로 권한 프로브를 먼저 돌렸다.

| 프로브 (일반 셸) | 결과 |
|---|---|
| `iptables -S DOCKER-USER` | ❌ `Permission denied (you must be root)` |
| `fail2ban-client status` | ❌ 소켓 권한 거부 |
| `ufw status` | ❌ root 요구 |
| `journalctl -u ssh.service` | ⚠️ 자기 유닛만 — 시스템 메시지 안 보임 |
| `ss -tlnp` | ✅ **부분 성공** — 포트 목록은 나오고 Process 열만 빔 |

### 0-1. ⚠️ 셸 프로브는 유닛 환경이 아니다 — sudo 는 애초에 불가능

에이전트 유닛에는 `NoNewPrivileges=yes` 가 있다. 이 플래그는 setuid 바이너리의 권한
상승을 커널 수준에서 차단하므로 **`sudo` 자체가 동작하지 않는다**. 위 셸 프로브가
"sudoers 만 깔면 된다"고 오해하게 만들었다 — Phase 2 D-Bus 사고와 같은 구조의 함정.

`systemd-run` 으로 유닛 환경을 재현해 실증했다:

```
# NoNewPrivileges=yes  → sudo: The "no new privileges" flag is set,
#                         which prevents sudo from running as root.
# NoNewPrivileges=no   → sudo: 암호가 필요합니다   ← sudo 자체는 정상
```

대조군이 "sudo 는 멀쩡하고 sudoers 규칙만 없다"를 증명하므로, 첫 실패의 원인은
`NoNewPrivileges` 로 단독 특정된다.

**따라서 sudoers 안을 폐기하고 root oneshot collector 로 전환한다** (A-1).

### 0-2. 그 밖의 실측

1. **DB/Redis 12개 중 일부는 앱 컨테이너에서 도달 불가** — `n8n-postgres`(127.0.0.1:5434),
   `ais-postgres`(127.0.0.1:5436) 는 루프백 바인딩, `sms-insights-postgres`·`n8n-redis` 는
   포트 미노출. → §G 수집기는 **컨테이너 cron 이 아니라 호스트 경로**여야 한다.
2. **cli-proxy 는 401 을 돌려준다** (`/v1/models` 무인증) — 살아있다는 뜻이므로
   기존 `judgeAvailability` 의 `<500 = up` 규칙이 이미 올바르게 처리 중. 변경 불필요.
3. **§I 는 상당 부분 이미 구현되어 있다** — `ollama.krdn.kr`·`claude.krdn.kr` 는 Phase 2 의
   `MONITORED_SITES` 에 이미 있고, GPU 지표는 Phase 1 vitals 에 있다.
   단 **LLM 비용은 "잔여 위젯 하나"가 아니다** — B-2 참조.

### 0-3. 물리 마이그레이션은 없지만 타입 변경은 있다

`check_results.kind` 와 `monitoring_events.source` 는 DB 상 자유 텍스트라
**물리 마이그레이션(psql 선적용)은 불필요**하다. 그러나 TypeScript 쪽은 다음이 필요하다:

| 대상 (파일) | 현재 | 변경 |
|---|---|---|
| `CheckVerdict.kind` (`judgeChecks.ts:13`) | `service｜timer｜hostcron` | + 신규 7종 |
| **`CheckVerdict.detail`** (`judgeChecks.ts:17`) | `Record<string, string｜number｜boolean>` | + `｜ string[]` — 포트·jail 배열의 **발원지** |
| **`CheckKind`** (`entities/monitoring/model/types.ts:14`) | `service｜timer｜hostcron｜http｜ssl` | + 신규 7종 — **공개 타입이라 함께 확장 필수** |
| `checkResults.detail` (`schema/monitoring.ts:113`) | `Record<string, string｜number｜boolean>` | + `｜ string[]` |
| **`LatestCheck.detail`** (`types.ts:75`) | 동일 scalar 전용 | + `｜ string[]` — 보드 표시 경로 |
| **raw 조회 타입** (`api/checks.ts` `db.execute<>`) | 동일 scalar 전용 | + `｜ string[]` |
| ingest 결선 (`monitoring-ingest/index.ts:102`) | `judgeChecks()` 만 호출 | + `judgeSecurity()` + `judgeDatastores()` 결합 |
| 이벤트 `source` (`index.ts:123`) | service 외 **전부 `"cron"`** | `sourceForKind()` 매핑 (아래) |
| 보드 표시 (`monitoring/page.tsx:60` `byKind()`) | kind 명시 필터 | 신규 kind 보드 추가 — **안 하면 `unknown` 이 사용자에게 안 보임** |

신규 kind 7종: `iptables` `fail2ban` `ufw` `portdrift` `sshfail` `pg` `redis`

kind → source 매핑 (신규 함수 `sourceForKind`):
`service`→`service` / `timer`·`hostcron`→`cron` / `iptables`·`fail2ban`·`ufw`·`portdrift`·`sshfail`→`security` / `pg`·`redis`→`host`

베이스라인(허용 포트, 기대 DOCKER-USER 규칙)은 DB 가 아니라
`features/monitoring-availability/config/sites.ts` 를 미러한 **레포 config 파일**로 둔다.

---

## PR-A — §H 보안 관제

### A-1. root oneshot collector (sudo 폐기)

`NoNewPrivileges=yes` 를 **유지**한 채 특권 정보를 얻기 위해, 특권 수집을 별도 유닛으로 분리한다.

```
scripts/monitoring-agent/gons-security-collect.sh      # root 실행, 네트워크·토큰 없음
scripts/monitoring-agent/gons-security-collect.service # Type=oneshot, User=root
scripts/monitoring-agent/gons-security-collect.timer   # 5분 주기
```

collector 가 실행하는 명령 (**전부 `timeout 5` 로 감싼다**):

| 필드 | 명령 |
|---|---|
| `iptables` | **`iptables -S`(전체)** → `^-N DOCKER-USER` 존재 확인 후 해당 체인 규칙 추출 (아래 ⚠️) |
| `fail2ban` | `fail2ban-client status` (jail 목록 파싱 → `jails: string[]`) |
| `ufw` | `ufw status` |
| `sshFail` | `journalctl -u ssh.service --since "1 hour ago" --no-pager` grep — **시간창 명시 필수** |
| `ports` | `ss -tlnH` — **collector 가 수집한다** (비특권 에이전트도 가능하지만, 수집 지점을 한 곳으로 모아 payload 병합 분기를 없앤다) |

결과를 **최소 JSON** 으로 `/run/gons-monitoring/security.json` 에 기록하고 즉시 종료한다.
에이전트(비특권)는 그 파일을 **읽기만** 한다. 파일이 없거나 오래되면(>15분) 미수집 처리.

보안상 이점: 상시 실행 프로세스에 권한을 주는 대신, 외부 통신도 토큰도 없는
단명 프로세스만 특권을 갖는다. 공격 표면이 sudoers 안보다 작다.

#### ⚠️ systemd 옵션 2건 — 운영 서버 실증 결과 (Codex 리뷰 2차 P0)

보안 강화 의도로 넣은 옵션 2개가 **기능을 침묵으로 깨뜨린다**. 둘 다 `systemd-run` 으로
운영 서버에서 실측했다.

**(1) `PrivateNetwork=yes` 금지** — 네트워크 네임스페이스는 인터페이스뿐 아니라
**netfilter 규칙 테이블 전체를 격리**한다. 격리된 네임스페이스에는 DOCKER-USER 가 없어
"규칙 0개 = 방어선 붕괴" 로 오판한다.

```
PrivateNetwork=yes  → iptables -S DOCKER-USER  = 1줄 (오류 메시지뿐)
격리 없음(대조)      → 6줄  ← 실제 규칙
IPAddressDeny=any   → 6줄  ✅ 호스트 netns 유지 + 외부통신 차단
```

→ **`IPAddressDeny=any` 로 대체**한다. 목적(외부 통신 차단)은 달성하면서 netns 는 보존된다.

**(2) `RuntimeDirectory=` 단독 금지** — 서비스 중지 시 디렉토리를 삭제한다.
`Type=oneshot` 은 종료가 곧 중지이므로 **파일을 쓰자마자 사라진다**.

```
RuntimeDirectory=rdtest1                             → 종료 후: 디렉토리 없음
RuntimeDirectory + RuntimeDirectoryPreserve=yes      → 종료 후: x.json 생존 ✅
```

→ **`RuntimeDirectoryPreserve=yes` 를 함께 지정**한다.
`RemainAfterExit=yes` 는 타이머 후속 실행을 막을 수 있어 해결책으로 쓰지 않는다.

최종 collector 유닛 옵션:
`Type=oneshot` `User=root` `ProtectHome=yes` `ProtectSystem=strict`
`IPAddressDeny=any` `RuntimeDirectory=gons-monitoring` `RuntimeDirectoryPreserve=yes`

- 원자적 쓰기: 임시파일은 **반드시 `/run/gons-monitoring/` 안에서** 생성 후 `mv`
  (다른 파일시스템 간 `mv` 는 원자성이 깨진다).
- 파일 권한 0640, 그룹 `gons-agent` — 다른 계정에 노출 금지.

> journal 은 **collector 안에서 ssh 유닛만 필터링**한다. 에이전트에 `systemd-journal`
> 그룹을 주는 안은 폐기 — 시스템 저널 전체 열람이라 최소권한이 아니다(Codex P0 #2).

### A-2. 수집 계약 — "관측 못 함"을 데이터로 표현

Phase 2 의 0바이트 로그 오탐을 되풀이하지 않기 위해, **모든 관측치는 `observed` 플래그를
동반**한다. 명령 실패 출력을 그대로 파이프라인에 넣지 않는다.

```jsonc
"security": {
  "iptables": { "observed": true,  "ruleCount": 6, "specHash": "ab12…" },
  "fail2ban": { "observed": false, "reason": "command-failed" },   // ← 빈 값 아님
  //           observed:true 일 때는 → { "observed": true, "jails": ["sshd", …] }
  "ufw":      { "observed": true,  "active": true },
  "ports":    { "observed": true,  "entries": ["tcp:0.0.0.0:6380", …] },
  "sshFail":  { "observed": true,  "failCount1h": 3 }
}
```

#### ⚠️ "체인 삭제"를 unknown 으로 뭉개지 말 것 (Codex 3차 P0)

`iptables -S DOCKER-USER` 는 **두 가지 다른 이유로 실패**한다:
① 권한 없음 = 진짜 관측 실패 → unknown ② **체인 자체가 삭제됨 = 관측 성공이자 최악의 critical**.
"명령 실패 → observed:false" 규칙은 ②를 ①로 뭉개서, **방어선이 통째로 사라진 사건에
관제가 침묵**하게 만든다 (Phase 2 오탐과 대칭인 미탐 함정).

운영 서버 실측: 없는 체인을 조회하면 오류 메시지가 `iptables: Incompatible with this
kernel.` 로 나온다 — **"체인 없음"으로 읽히지 않는다**(nf_tables 백엔드). 메시지 파싱은 취약.

→ **`iptables -S`(전체)를 먼저 조회**하고, 그 성공 여부로 observed 를 판정한 뒤
`^-N DOCKER-USER` 매칭으로 체인 존재를 따로 판정한다. 실측 확인: 존재 시 grep -c = 1.

```jsonc
"iptables": { "observed": true, "present": false }              // 체인 삭제 → critical
"iptables": { "observed": true, "present": true, "ruleCount": 6, "specHash": "…" }
"iptables": { "observed": false, "reason": "permission-denied" } // → unknown
```

규칙:
- **exit status 를 변환 전에 확인** — 성공한 출력만 해시·grep·파싱한다.
  빈 문자열의 해시나 `ports: []` 가 정상 관측으로 저장되는 경로를 차단.
- 모든 외부 명령에 **`timeout 5`** — 한 곳의 hang 이 에이전트 루프 전체(및 vitals 전송)를
  멈추는 것을 방지.
- 파일 부재/노후도 `observed:false` 로 정규화.

### A-3. 판정 (`judgeSecurity.ts` — 순수 함수)

`judgeChecks.ts` 를 미러하되 **기대되는 모든 점검에 항상 verdict 를 생성**한다.
필드 생략 시 verdict 자체가 안 생기면 보드에 이전 상태가 남는다(Codex P1 #3).

| kind | `observed:false` | 판정 |
|---|---|---|
| `iptables` | unknown | **`present:false`(체인 삭제) → critical** / 기대 규칙 수 불일치 **또는** 해시 변경 → **critical** (유일한 인터넷 방어선) |
| `fail2ban` | unknown | 기대 jail(`sshd`) 부재 → warning / 존재 → ok |
| `ufw` | unknown | inactive → critical / active → ok |
| `portdrift` | unknown | 허용목록 밖 항목 등장 → warning (신규 목록을 detail 에) |
| `sshfail` | unknown | 1시간 100회 초과 → warning |

- **fail2ban 미수집은 warning 아닌 unknown** — "권한 실패는 unknown" 규칙과 일관되게.
  정상 수집된 `sshd` jail 부재만 warning.
- **iptables 해시는 `-S`(규칙 스펙)만** — `-L -v` 는 패킷 카운터가 매 조회마다 변해
  5분마다 거짓 드리프트를 만든다. 스펙도 공백 정규화 후 sha256.
- **포트 비교는 `protocol:bindAddr:port` 튜플** — 포트 번호만 비교하면
  `127.0.0.1:5434` → `0.0.0.0:5434` 노출 확대를 놓친다(Codex P1 #6). UDP 는 범위 외로 명시.
- 사라진 포트는 무이벤트(의도적 — 서비스 중단은 다른 체크가 잡음).

기대값 baseline 은 `features/monitoring-security/config/baseline.ts`.
**최초 배포 시 해시·포트 목록은 실측값으로 채운다** (collector 1회 실행으로 획득).

### A-4. 표시

`/monitoring` 에 **보안 보드** 1개 추가 (`SecurityBoard.tsx`) — 기존
`ServicesBoard`/`AvailabilityBoard` 와 동일한 `check_results` 최신행 조회 패턴.
`unknown` 은 회색으로 명확히 구분해 "관측 공백"이 "정상"으로 안 보이게 한다.

---

## PR-B — §G DB/Redis + §I LLM 비용

### B-1. DB/Redis liveness

앱 컨테이너에서 전부 도달하지 못하므로 **호스트 경로**로 점검한다.
자격증명 없이 **liveness 만** — 연결 수·DB 크기는 인증이 필요해 Phase 4 로 미룬다.

대상 명시 (실측 기준, **총 12** = PG 7 + Redis 5):

| kind | 대상 | 주소 |
|---|---|---|
| `pg` | gons-dashboard / ais-prod / krdn-timescaledb / voice / n8n / ais | 127.0.0.1:5440·5438·5435·5437·5434·5436 |
| `pg` | sms-insights | **포트 미노출** → 항상 `unknown` |
| `redis` | gons-dashboard / ais-prod / news-prod / voice | 127.0.0.1:6390·6385·6380·6382 |
| `redis` | n8n | **포트 미노출** → 항상 `unknown` |

**대상 목록의 이중 소스 문제와 배포 계약**: 판정은 서버가, 수집은 셸 에이전트가 한다.
`sites.ts` 는 서버가 직접 프로브해서 문제없었지만, 여기선 **에이전트도 목록을 알아야 한다**.

→ 목록의 **단일 소스는 서버측** `features/monitoring-datastore/config/instances.ts`
(`sites.ts` 미러). 각 항목 `{ kind, target, port? }` — `port` 없음 = 미노출.
에이전트에는 `HOSTCRON_SPECS` 와 **동일한 env 규약**으로 전달한다:

```
DATASTORE_SPECS="pg|gons-dashboard|5440 pg|ais-prod|5438 … pg|sms-insights| redis|n8n|"
```

(`/etc/default/gons-monitoring-agent`, 포트 빈 값 = 미노출 → 에이전트가
`observed:false, reason:"not-exposed"` 로 행 생성)

**드리프트 방어**: env 와 `instances.ts` 가 갈릴 수 있으므로 —
`judgeDatastores` 는 **`instances.ts` 를 기준**으로 순회하고, payload 에 없는 target 은
`unknown`(`reason:"not-reported"`) 행을 **생성한다**. 에이전트 env 가 낡아 일부가 누락돼도
보드에서 관측 공백으로 드러난다. README 에 두 곳을 함께 갱신하도록 명시.

**수집·판정·결선 계약** (§H 와 동일 구조):

- 수집: collector 가 아닌 **에이전트**가 실행 (특권 불요).
  `pg_isready -h 127.0.0.1 -p <port>` / `redis-cli -p <port> ping`, 각각 `timeout 5`.
  부재 시 `nc -z` 폴백. exit status 를 변환 전 확인.
- payload: checks 에 `datastores: [{ target, kind, observed, reachable?, reason? }]` 섹션 추가.
  Zod 스키마는 `checksSchema.ts` 에 확장.
- 판정: `judgeDatastores.ts` 순수 함수 — `observed:false` → **unknown** /
  `reachable:false` → **critical** / `reachable:true` → ok.
  포트 미노출 대상은 에이전트가 `observed:false, reason:"not-exposed"` 로 **항상 행을 낸다**
  (제외하면 관측 공백이 사용자에게 안 보인다 — Codex P1 #7).
- 결선: `ingestChecks` 에서 `judgeChecks()` 와 함께 호출, `sourceForKind` 로 `host` 매핑.
- 표시: `/monitoring` 에 **데이터스토어 보드** 추가 (`page.tsx` 의 `byKind("pg"/"redis")`).
  `unknown` 회색 표시로 "관측 공백 ≠ 정상" 을 시각적으로 구분.
- `NOAUTH`·비밀번호 요구 응답은 **ok** — 응답이 왔다는 것 자체가 liveness.
- Phase 4 이관: 연결 수·DB 크기(인증 필요), 미노출 2건의 컨테이너 healthcheck 승격.

### B-2. LLM 비용 위젯 (§I 잔여) — 범위 정정

실측 결과 `llm_spend_log` 에 실제로 INSERT 하는 경로는 **사주뿐**이다
(`logSajuSpend`). 이메일·메모의 `logLlmSpend` 는 DB 가 아니라 구조화 로그에
raw token 만 남긴다 — 즉 이 테이블을 그대로 읽으면 **대부분의 비용을 누락**한다(Codex P1 #8).

따라서 이번엔 **"사주 LLM 비용"으로 명시 한정**한 카드를 만든다. 위젯 제목과 툴팁에
집계 범위를 밝혀 "전체 LLM 비용"으로 오독되지 않게 한다.
전체 비용 통합(모든 호출의 DB 기록화)은 별건이므로 **Phase 4 항목으로 이관**한다.
일/월 경계는 **KST** 로 명시한다.

---

## 3. 함정 (Phase 1·2 에서 학습한 것)

1. **셸 프로브 ≠ 유닛 환경** — 샌드박스 옵션(`NoNewPrivileges` 등)까지 재현해 검증할 것.
   `systemd-run -p <옵션>` 이 그 도구.
2. **오탐보다 무이벤트** — 권한/명령 실패는 `unknown`. 단, verdict row 자체는 항상 생성.
3. **수집 잡은 catchup 제외** — 재배포 시 몰아 실행 방지 (이슈 #323 §5-7).
4. **`/monitoring` 은 per-page `auth()` 가드 필수** — 레이아웃에 가드 없음.
5. **호스트 배포물이 늘어난다**: `agent.sh`, `.service`, (신규)collector 스크립트·유닛·타이머.
   전부 수동 배포 — README 절차 갱신 필수.

## 4. 검증

- `pnpm typecheck && pnpm lint && pnpm test` (judgeSecurity 순수 함수 단위 테스트 포함 —
  특히 `observed:false` 경로가 unknown 을 내는지, 포트 튜플 비교가 bind 주소 변경을 잡는지)
- `cd apps/dashboard && pnpm build` — features barrel seam 회귀 방지(Gotcha #7)
- 호스트: collector 1회 실행 → `/run/gons-monitoring/security.json` 이
  **종료 후에도 생존**하는지 + 내용이 비지 않았는지(iptables 6줄) 확인 →
  `systemd-run -p NoNewPrivileges=yes --uid=gons-agent` 로 에이전트가 읽히는지 실증
- baseline 초기값: collector 1회 실행 결과의 `specHash`·`ports.entries` 를 그대로 채운다
- 배포 후 `/monitoring` 보안 보드가 `unknown` 이 아닌 실제 판정을 보이는지 확인
