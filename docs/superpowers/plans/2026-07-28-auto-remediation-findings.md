# 자동 복구 Phase 1 — 활성화 전 선결 사항 (구현 후 발견)

> 이슈 #352 / 브랜치 `feat/auto-remediation-phase1` / 계획 `2026-07-28-monitoring-auto-remediation.md`
>
> 9개 태스크 구현·리뷰를 마친 뒤, 조립 층(태스크 경계를 넘는 지점)에서 발견한 결함 기록.
> **구현 결함이 아니라 계획의 전제 결함이다** — 9개 태스크 모두 계획대로 정확히 구현됐고,
> 태스크별 리뷰도 각자 diff 안에서는 옳게 판정했다. 아래 결함은 어느 태스크의 diff 에도 없다.

## 요약

`AUTO_REMEDIATE_ENABLED=true` 로 켜기 전에 **반드시** 해결해야 한다. 현재 브랜치는 안전하다 —
env 미설정이 기본이고 그 값 없이는 조치가 실행되지 않는다.

| # | 결함 | 심각도 | 상태 |
|---|---|---|---|
| 1 | `prune-images` 가 관계없는 이벤트에 오매칭 | **위험** | **해결** (`6a66544` — mount 실측값 요구) |
| 2 | 정책 3종이 실제 이벤트 `detail` 계약과 불일치 | 기능 무효 | 선택지 (iii) 채택 — Phase 2 선결 조건으로 이월 |
| 3 | 보드에 조치 대상이 표시되지 않음 | Phase 1 목적 무효 | **해결** (`772c657` — detail 추출 + dedupKey 노출) |
| 4 | skip 중복 억제 키에 실행 모드 누락 | 경미 | **해결** (`6b22266` — 매칭에 dryRun 포함) |

---

## 1. `prune-images` 오매칭 (위험)

`config/policies.ts` 의 `pruneImages.buildAction` 은 `detail.usedPct >= 85` 만 본다.
**그 `usedPct` 가 무엇의 비율인지 확인하지 않는다.**

실제로 `usedPct` 를 JSON `detail` 에 싣는 이벤트 생산자:

| 생산자 | `usedPct` 의미 | JSON detail? |
|---|---|---|
| `judgeDatastoreStats` → pgstat | postgres **연결** 사용률 | 예 |
| `judgeDatastoreStats` → redisstat | redis **메모리** 사용률 | 예 |
| `evaluateVitals` → disk | 디스크 사용률 | **아니오** (아래 §2) |

그리고 `POLICIES = [restartContainer, pruneImages, redisMaxmemory]` 순서에
`selectActions` 가 **첫 매칭에서 `break`** 한다. 결과:

```
Redis 메모리 90% 경보
  → restartContainer  skip (식별자 누락)
  → pruneImages       usedPct 90 >= 85  → ACTION: docker image prune  ← break
  → redisMaxmemory    평가되지 않음
```

postgres 연결 고갈 85% 도 동일하게 `docker image prune` 을 유발한다.

계획서 Global Constraint 1 은 "조치 조건은 실측값만 사용한다. 이름·prefix·관례를 조건에
넣지 않는다" 인데, 정책이 **필드 이름으로 매칭**해 출처가 다른 지표를 같은 것으로 취급한다.
막으려던 실수를 같은 형태로 재현했다.

### ⚠️ `source` 로는 구분할 수 없다 (Codex 리뷰 지적, 확인됨)

처음에 "`event.source` 로 디스크 이벤트만 매칭하도록 좁힌다" 를 제안했으나 **성립하지 않는다.**
`monitoring-ingest/lib/sourceForKind.ts:23-27` 이 `pg`/`redis`/`pgstat`/`redisstat` 에 대해
`"host"` 를 반환한다 — `evaluateVitals` 의 디스크 이벤트와 **같은 source 값**이다.

`OpenEventView` 에서 쓸 수 있는 것은 `id, dedupKey, severity, source, title, detail,
occurredAt, hostId` 뿐이고:

- `source` — 위 이유로 구분 불가
- `dedupKey` prefix (`disk:` 등) — 구분은 되지만 **Global Constraint 1 정면 위반**.
  prefix 기반 판단은 2026-07-28 수동 복구에서 두 번 틀렸던 바로 그 방식이라 계획이 금지했다.
- `detail` 형태 — 디스크 이벤트는 `detail` 이 **null**, datastore 는 JSON. 즉 "JSON detail 에
  usedPct 가 있다" 는 조건은 정확히 **datastore 만** 고르는 조건이다. 뒤집혀 있다.

**결론: 현재 이벤트 모델에서 `prune-images` 가 디스크 이벤트를 고를 방법은 없다.**
디스크 사용률의 유일한 소재가 `title` 문자열이기 때문이다.

### 올바른 최소 수정

`prune-images` 가 **디스크 이벤트만 만족시킬 수 있는 양성 조건**을 요구하게 한다 — 예를 들어
`detail.mount` 또는 `detail.kind === "disk"`. 현재 그 필드를 만드는 생산자가 없으므로 이 정책은
**항상 skip** 하게 되고, skip 사유가 선결 조건(디스크 이벤트의 구조화된 detail)을 문서화한다.

오매칭(위험)이 사라지고, 보드에는 "왜 발동하지 않는가" 가 근거와 함께 남는다.

`restart-container` 와 `redis-maxmemory` 는 **등록된 채 둔다** — 둘은 skip 만 만들어 무해하고,
그 skip 사유가 이벤트 계약의 공백을 그대로 증거로 남긴다. 위험한 것은 *조치를 만들어내는*
`prune-images` 하나뿐이다.

---

## 2. 정책 3종이 실제 이벤트 `detail` 계약과 불일치

계획서는 이벤트 `detail` 이 구조화된 JSON 이고 특정 필드를 담는다고 가정했으나,
실제 생산자들은 그 계약을 구현하지 않는다.

### 이벤트 생산자 전수 (`recordEvent` 호출부)

| 파일 | source | detail |
|---|---|---|
| `monitoring-ingest/index.ts:74` | `host` | `verdict.detail` — **`evaluateVitals` 가 만들지 않음 → 항상 undefined** |
| `monitoring-ingest/index.ts:149` | `sourceForKind(v.kind)` (pgstat/redisstat 등) | `JSON.stringify(v.detail)` |
| `monitoring-availability/index.ts:60` | `http` | 평문 문자열 (JSON 아님) |
| `monitoring-availability/index.ts:116` | `ssl` | 없음 |
| `github-monitor/index.ts:255` | github | — |
| `monitoring-remediate/api/runCycle.ts:138` | `host` (영구화 필요 알림) | JSON |

**`source: "container"` 이벤트를 만드는 곳은 저장소에 없다.**

### 정책별 판정

**`restart-container`** — `detail.containerName` + `detail.containerId` 를 요구.
이 필드를 싣는 생산자가 없고 `container` source 자체가 없다. → 영구히
`"컨테이너 식별자 누락"`.

**`prune-images`** — `detail.usedPct` 를 요구. 디스크 판정은 `evaluateVitals.ts:67` 의
`tiered("disk:${mount}", disk.usedPct, ...)` 로 존재하지만, `tiered()` (`:40-57`) 는
`{ dedupKeySuffix, violated, severity, title }` 만 반환하고 **`detail` 을 만들지 않는다.**
사용률 값은 `title` 문자열 안에만 들어간다 (`디스크 / 사용률 91.2% (임계 90%)`).
→ 진짜 디스크 이벤트는 `detail` 이 null 이라 `"detail 파싱 불가"` 로 skip.
→ 대신 §1 의 datastore 이벤트에 오매칭한다.

**`redis-maxmemory`** — `detail.target` 을 요구. `judgeDatastoreStats` 의 verdict 는
`{ kind, target, detail, dedupKeySuffix }` 구조로 **`target` 이 `detail` 의 형제 필드**이고,
`monitoring-ingest/index.ts:153` 이 `detail: JSON.stringify(v.detail)` 로 `detail` 만
직렬화한다. → `d.target` 이 항상 undefined → `"target/maxMemBytes 관측값 없음"`.
(계획서는 이 정책이 호스트 여유 메모리 회로 차단기 때문에 항상 skip 된다고 예상했으나,
실제로는 그 지점에 도달하기도 전에 막힌다.)

### 선택지

- **(i) 이벤트 생산자를 확장** — `evaluateVitals` 가 구조화된 `detail` 을 만들고,
  ingest 가 `target` 을 함께 직렬화하고, 컨테이너 이벤트 생산자를 신설.
  이 계획의 범위 밖이며 기존 관제 시스템을 건드린다.
- **(ii) 정책이 현존하는 것을 읽도록 변경** — `title` 문자열 파싱 등. Global Constraint 1
  위반이고 취약하다. 권장하지 않는다.
- **(iii) Phase 1 범위를 명시적으로 축소** — 기계장치(테이블·게이트·claim·cron·보드)는
  완성됐고, 정책은 Phase 2 에서 이벤트 `detail` 계약을 정비한 뒤 활성화한다고 스펙에 명시.
  §1 의 위험만 지금 막는다 (`pruneImages` 를 출처로 좁혀 오매칭 차단).

**→ (iii) 채택 (2026-07-28).** Phase 1 은 기계장치 완성 + 전 정책 상시 skip 상태로
마무리한다. 정책 활성화(`AUTO_REMEDIATE_ENABLED=true`)의 선결 조건:

1. `evaluateVitals` 의 `tiered()` 가 구조화된 `detail`(최소 `mount`, `usedPct`)을 생성
   — `prune-images` 활성화 조건.
2. `monitoring-ingest` 가 datastore verdict 의 `target` 을 `detail` 에 포함해 직렬화
   — `redis-maxmemory` 활성화 조건. 직렬화 시 target 컨테이너명 형식 검증(선행 `-`
   거부, 예: `/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/`)을 함께 추가 — restart 경로의
   CONTAINER_ID_RE 와 달리 redis 경로는 무검증이라 docker CLI 플래그 오파싱 여지
   (최종 리뷰 지적; 현 출처는 서버측 `DATASTORE_INSTANCES` 신뢰 config 라 실위험 낮음).
3. `source: "container"` 이벤트 생산자 신설 (containerName·containerId 를 detail 에)
   — `restart-container` 활성화 조건.
4. **`dry_run` outcome 반복 억제 설계** — skip 은 6h reasonShape 억제, executed/failed 는
   COUNTED 쿨다운이 있지만 dry_run 은 어느 쪽에도 안 걸린다 (`COUNTED_OUTCOMES` 제외는
   ruling-4 의 의도지만 반복 브레이크의 대체 장치가 없다). 매칭 open 이벤트 1건당
   5분마다 1행 = 288행/일이 쌓여 보드(LIMIT 50)가 도배되고, 활성화 전 dry-run 검토
   절차 자체가 수행 불가해진다 (최종 리뷰 확정 3/3). 현 브랜치는 전 정책 상시 skip 이라
   도달 불가 — dry-run 관찰 기간 시작 전에 반드시 설계.
5. `notifyIfPermanenceNeeded` 이벤트의 해소 경로 — auto-resolve 없이 매 사이클 open
   조회에 재유입 (현재는 회로 차단기 때문에 도달 불가, Phase 2 에서 풀리면 발현).
6. 켜기 전 dry-run 보드에서 계획 검토 기간 확보 (계획서 명시 절차).

---

## 3. 보드에 조치 대상이 표시되지 않음

`widgets/monitoring/ui/RemediationBoard.tsx` 가 렌더하는 것: `outcome` 배지, `policyId`,
시각, `action`(조치 **종류** 문자열), `reason`.

렌더하지 않는 것: **`detail`** (= `JSON.stringify(plan.action)` — `hostId`·`containerId`·
`containerName`·`target`·`nextBytes` 가 여기 있다), `dedupKey`, `eventId`.

한 행이 이렇게 보인다:

```
restart-container  [dry_run]  16:33:02
```

**무엇을 재시작하려 했는지가 없다.** Phase 1 의 목적은 사람이 dry-run 계획을 검토하는 것인데,
대상을 모르면 "이 판단이 맞나?" 를 판단할 수 없다.

데이터는 `listRecentRemediations` 가 `select()` 로 이미 전부 가져온다 — 순수 렌더링 누락이다.

**수정:** `detail` 에서 대상 식별자를 뽑아 표시하거나, `dedupKey` 를 함께 노출한다.

---

## 4. skip 중복 억제 키에 실행 모드 누락 (경미)

`api/attempts.ts` 의 `recordSkip` 중복 억제 키는 `(dedupKey, policyId, reasonShape)` 이고
`dryRun` 을 포함하지 않는다. dry-run 모드에서 skip 이 기록된 뒤 6시간 안에
`AUTO_REMEDIATE_ENABLED=true` 로 켜면 실제 모드의 같은 skip 이 억제되어, 보드가 최대 6시간
낡은 모드를 보여준다. 모드 전환 직후가 로그가 현실을 반영해야 할 가장 중요한 순간이다.

**수정:** 중복 억제 매칭에 `dryRun` 을 포함한다.

---

## 이연 항목 (최종 브랜치 리뷰에서 판단)

- `runRemediationCycle` 자체 통합 테스트 없음 — 5분마다 도는 유일한 진입점인데 어떤 테스트도
  실행하지 않는다. 조각은 테스트가 있으나 조립이 없고, 위 §1~§4 가 정확히 조립 층의 결함이다.
- `reapStaleInFlight` 가 고아를 `"failed"` 로 정리하는데 `"failed"` 는 `COUNTED_OUTCOMES` 에
  포함 — 크래시 구간에 한해 시도 예산이 소진된다.
- skip 루프(`runCycle.ts:69-76`)에 에러 격리 없음 — `recordSkip` throw 시 사이클 전체 중단.
- 전역 `ORDER BY attempted_at DESC` 가 `remediation_attempts_dedup_idx`
  `(dedup_key, attempted_at DESC)` 의 선두 컬럼과 안 맞아 Seq Scan + Sort.
- `isUniqueViolation` 이 `entities/monitoring/api/events.ts:21-27` 과 완전 중복 — 공유 유틸 추출 검토.
- `monitoring-purge` 라우트에 유닛 테스트 없음 (기존 4개 case 포함). 데이터 삭제 경로.
- `notifyIfPermanenceNeeded` 이벤트가 auto-resolve 없이 다음 사이클에 다시 잡힘 — 현재는
  `readHostAvailableMemBytes`=null 이라 도달 불가, Phase 2 에서 회로 차단기가 풀리면 재귀 형태.

## 최종 브랜치 리뷰 결과 (2026-07-28)

5차원(조립·보안·DB·컨벤션·테스트) 파인더 + Critical/Important 발견당 3-렌즈(반박·재현·영향)
적대적 검증, 총 18 에이전트. 전체 diff `0869fde...HEAD` 대상.

- **확정 (3/3) 2건**: ① dry_run 반복 억제 부재(→ 위 선결 조건 4로 등재), ② selectActions
  "조치 최대 하나" 테스트가 마지막 정책에만 매칭되는 픽스처라 first-match break 제거를
  못 잡는 무효 검증 → 정책 3종 동시 매칭 픽스처로 교체, break 제거 mutation 으로 실증.
- **기각 (0/3) 1건**: "redis target 이 METRICS_INGEST_TOKEN 만으로 docker exec 에 도달"
  — target 의 실출처는 서버측 `DATASTORE_INSTANCES` 신뢰 config 로 확인(에이전트 payload
  아님). 형식 검증 비대칭만 선결 조건 2에 병기.
- **Minor 9건**: RESTART_EXCLUDED 가 이름 기준인데 실행은 id 기준 / eventId FK cascade 가
  이벤트 보존 기간에 종속 / settle-reap 이중 실행 창 / prune-images 의 이벤트 단위 claim /
  restart 실패 메시지 유실 / dry-run 배지 회귀 테스트 부재 / 미지 severity 폴백 미검증 /
  eventId 이중 캐스트 픽스처 / target 형식 검증. 전부 dry-run 기본값에서 무해 — Phase 2
  선결 작업과 함께 처리.

## 구현 상태 (참고)

9개 태스크 전부 완료 + 결함 §1·§3·§4 수정 완료 (`6a66544`·`772c657`·`6b22266`).
`feat/auto-remediation-phase1`. `pnpm build` 통과, 1648/1648 (240 파일).
태스크별 커밋·리뷰·판정 이력은 `.superpowers/sdd/2026-07-28-monitoring-auto-remediation/progress.md`.
