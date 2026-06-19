# gons-dashboard

개인 사용자 통합 대시보드. 도메인을 점진 추가하는 워크스페이스 — 현재 이메일 분석, 서버 인프라 모니터, 사주(saju)가 활성 도메인.

이 문서는 코드와 대화에서 일관되게 써야 할 도메인 어휘를 정의한다. 일반 프로그래밍 개념(timeout, retry, cache)은 여기 두지 않는다 — 이 프로젝트 *고유*의 개념만.

## Language

### 사주 (Saju)

**사주 차트** (saju chart):
출생 정보(양력 일시 + 시간대)로부터 결정론적으로 도출된 4기둥 + 십신 + 오행 + 격국 + 용신/기신 + 대운 묶음. 한 사용자 프로필은 정확히 하나의 활성 차트를 가진다. (테이블: `saju_charts`)
_Avoid_: 사주팔자(too narrow — 4기둥만 지칭), 운명도

**프로필** (fortune profile):
한 사용자가 등록한 *한 사람*의 출생 정보 단위. 사용자는 본인/가족/지인 여러 명을 등록 가능. `is_active=true` 인 프로필만 일진 자동 생성 대상. (테이블: `fortune_profiles`)
_Avoid_: 사용자, 멤버

**리딩** (reading):
사주 차트를 입력으로 LLM이 생성한 자연어 해석 결과. **세 종류로 갈린다:**

- **섹션 리딩** (section reading) — 평생 단위 해석. `section ∈ {overview, personality, career, health, major_fortune}`. (테이블: `saju_readings`, key=`(chartId, section)`)
- **세운** (yearly reading) — 한 해(`year`)의 흐름. 연주 + 12개월 월주를 묶어 하나의 markdown 본문으로. (테이블: `saju_yearly_readings`, key=`(chartId, year)`)
- **일진** (daily fortune) — 하루의 흐름. 일주 + 십신을 구조화된 JSON payload로 (markdown 아님). (테이블: `saju_daily_fortunes`, key=`(chartId, forDate)`)

_Avoid_: 풀이(too informal in code), 해석본

**결정적 계산** (deterministic computation):
사주 차트와 키(date, year)로부터 LLM 없이 *결정론적으로* 도출되는 데이터. `computeDayPillar`, `computeYearPillar`, `computeMonthPillars`, `tenGodsForPillar` 등이 해당. 캐시-리딩 모듈의 책임 *밖* — caller가 미리 계산해 prompt builder에 넘긴다.
_Avoid_: 사전 처리

**프롬프트 버전** (prompt version):
같은 사주 차트라도 prompt가 바뀌면 옛 LLM 응답을 stale로 간주하기 위한 cache 무효화 키. cache 행은 `(model, promptVersion)` 둘 다 일치할 때만 hit. buildPrompt 함수가 `version` 문자열을 결과에 같이 반환한다.

**예산 가드** (budget guard):
사주 LLM 호출의 일일 KRW 예산. `env.SAJU_LLM_DAILY_BUDGET_KRW` 와 `llm_spend_log` (feature='saju') 합산을 비교. 초과 시 `BudgetExceededError`. 사주에만 있고 이메일 분류 LLM에는 없다.

**캐시-리딩 모듈** (cached reading module):
"이 차트 × 이 키에 대한 리딩을 가져오거나 (없으면) LLM을 호출해 생성한다"는 단일 책임의 깊은 모듈. cache lookup + model/promptVersion 비교 + budget guard + LLM 호출 + spend log + UPSERT 시퀀스를 묻는다. **2개 entry point** — `cachedReading<T>` (일반형, 일진처럼 structured payload + Zod validator) + `cachedMarkdownReading` (공통 case sugar, 섹션 리딩/세운). caller는 *(table, where, conflictTarget, prompt+version, validator?, toRow / extraColumns)* 만 제공. db/`callSajuLlm`/`assertSajuBudgetOk`/`logSajuSpend`/`env.SAJU_LLM_MODEL`은 모듈 내부에 묻힘. 재시도는 caller 책임. Design spec: `docs/superpowers/specs/2026-05-14-saju-cached-reading-deepening.md`.

**캐시-narrative 모듈** (cached narrative module):
삼국(tri-nation) v0.2 narrative 의 cache-or-generate 를 묻는 깊은 모듈 (`createNarrativeCache<Frame, Extra, Sections, Result>` factory, `shared/lib/saju/`). **캐시-리딩 모듈과 별개** — 캐시-리딩 모듈은 `callSajuLlm` (단일 호출, 재시도는 caller 책임) 기반의 *레거시 saju 리딩* (섹션 리딩/세운/일진) 용이고, 캐시-narrative 모듈은 `analyzeStructured` + **ZodError 1회 재시도를 factory 가 소유** 하는 *삼국 학파별 narrative* (lifetime/yearly/monthly/daily × 한/중-자평/중-맹파/일) 용이다. 재시도 책임 위치가 반대라 한쪽이 다른 쪽의 조상이 아니다. factory 는 frameHash 기반 cache 조회 + null 자가치유 가드 (sections·schoolSpecific 둘 다) + retry 루프 + `analyzeStructured`/`normalizeUsage`/`computeKrw` **정책 시퀀스** 를 묻고, **언제** 호출할지(budget→LLM→spend 순서)를 소유한다. DB I/O(`findCached`/`insertCache`/`toResult`) 와 budget/spend(`assertBudget`/`logSpend`) 는 **caller 가 콜백으로 주입** — `createSajuTriCache` 의 `findCached`/`insertCache` 위임 패턴 미러 + FSD 순수성(factory 는 shared 라 `features/saju-reading` 의 budget 을 직접 import 못 함, caller 가 주입). DB-shape 변이(테이블·추가 키 `Extra`=`forDate`/`targetYear`/`targetMonth`·envelope 추가 필드)가 4곳(WHERE·INSERT·conflict target·envelope)에 흐르므로 declarative `table` 슬롯으로는 컴포즈 안 됨 — 모든 콜백이 매 호출 `ctx: NarrativeCallContext<Frame, Extra>` 를 받아 `ctx.extra` 에서 추가 키를 꺼낸다. caller(4개 tri narrative-server)는 config 한 객체 *(logTag, schema, maxTokens, assertBudget, logSpend, buildSystemPrompt, buildUserContent, findCached, insertCache, toResult)* + 얇은 export wrapper 만 제공 — prompt 텍스트(분량 문구·JSON 스키마 예시·schoolSpecific 예시)는 `buildUserContent(ctx)` 콜백 뒤에 묻혀 prompt 변형 시 factory 무수정. retry/cache/spend 정책 시퀀스 (narrative-server 4벌, 약 730줄) 가 factory 1벌로 수렴. `createSajuTriCache` (frame 캐시) + `createNarrativeHandler` (route) 와 함께 삼국 사주의 thick-adapter/thin-factory 삼총사를 이룬다. Design spec: `docs/superpowers/specs/2026-06-19-saju-narrative-cache-deepening.md`.

### 이메일 (Email)

**스레드** (email thread):
Gmail thread 단위. `gmailThreadId` 로 식별. (테이블: `email_threads`)

**답장 필요** (reply-needed):
스레드 분류 결과 중 사용자가 답장해야 풀리는 메일. deterministic 후보 → LLM 정밀 검증 2단계. `reason` 은 40자 이내 한국어 1줄.
_Avoid_: 회신 필요, needs-response

**중요한 메시지** (important emails):
"답장 필요"와 직교하는 별개 분류. 답장 필요 없어도 중요할 수 있고 그 반대도 가능. `severity ∈ {high, med, low}`. (테이블: `important_emails`)

**디지스트** (digest):
매일 아침 8시 KST에 사용자에게 보내는 push 알림 — 답장 필요 TOP 5 묶음. 빈 디지스트는 알림 보내지 않는다(노이즈 회피).

### 서버 인프라 (Server Infra Monitor)

**호스트** (host):
모니터 대상 Docker 머신. `dockerContext` (예: `home-server`, `krdn-lenovo`) 로 docker CLI 가 SSH 트랜스포트 + 인증 처리. (테이블: `hosts`)
_Avoid_: 서버, 머신

**호스트 카탈로그** (host catalog):
사용자가 보는 호스트 목록 + 각 호스트의 docker context 메타. `getHosts`/`getHostByName` 으로 조회.

**프로젝트** (project, compose project):
docker compose 라벨로 묶인 컨테이너 그룹. 처음 보는 compose 라벨은 자동 등록(화이트리스트 폐지 — Gotcha #4). 한글 displayName/카테고리/URL 은 운영자가 부여. (테이블: `projects`)
_Avoid_: 앱, 서비스(서비스는 compose service 와 충돌)

**감사 로그** (audit log):
container action(restart/start/stop)의 success/failed 양 경로 기록. 운영자 email + duration + 에러 메시지(500자 절단) 포함. (테이블: `container_audit_logs`)

### Cron

**활성 대상** (active target):
cron 핸들러가 fan-out 하는 대상 집합. poll-gmail/morning-digest 는 `users.oauthState='active'`, generate-daily-fortunes 는 `fortuneProfiles.isActive=true × 차트 INNER JOIN`.

**부분 실패 격리** (per-target failure isolation):
한 대상의 실패가 다른 대상을 막지 않게 하는 정책. **캐시-cron 셰이프 모듈** (`createCronHandler`) 이 통일된 격리 + 에러 메시지 200자 절단 + concurrency 제어를 모두 묻는다. caller 는 `concurrency` 정책만 결정 (LLM cron 은 2, push 는 10, sync 는 5). Design spec: `docs/superpowers/specs/2026-05-15-cron-handler-deepening.md`.

**캐시-cron 셰이프 모듈** (`createCronHandler` factory):
"bearer 검사 → 활성 대상 select → per-target 작업 + 부분 실패 격리 → 결과 envelope" 시퀀스를 묻는 도메인-무관 깊은 모듈. 각 cron route 는 `export const POST = createCronHandler({...})` 한 줄. 응답 envelope `{name, runAt, timezone, total, succeeded, failed, results[], extra?}` 완전 강제 — 운영 모니터링 일관성이 모듈의 존재 이유. cron-specific 글로벌 카운트 (예: `reauthRequired`) 는 `extra` 슬롯에 흡수.

## Relationships

- 한 **프로필** 은 하나의 **사주 차트** 를 갖는다 (1:1, 차트 없는 프로필은 일진 생성 대상이 아님).
- 한 **사주 차트** 는 여러 **리딩** 을 갖는다 (섹션 리딩 N개 + 세운 N개 + 일진 N개).
- **캐시-리딩 모듈** 은 *모든* 리딩 종류의 cache-or-generate 사이클을 묻는다 — caller(섹션/세운/일진 generator)는 *결정적 계산 + 프롬프트 + validator + row mapping* 만 제공.
- **결정적 계산** 은 캐시-리딩 모듈의 책임 밖 — caller 가 호출해 prompt builder 에 넘긴다.
- **예산 가드** 는 사주 캐시-리딩 모듈 내부에 묻힌다. 이메일 분류 LLM 은 예산 가드를 쓰지 않는다.
- 한 **호스트** 는 여러 **프로젝트** 를 갖는다. 한 **프로젝트** 는 여러 컨테이너를 갖는다.
- **스레드** 의 *답장 필요* 분류와 *중요한 메시지* 분류는 독립 — 한 스레드가 둘 다, 하나만, 또는 둘 다 아닐 수 있다.

## Example dialogue

> **Dev**: "**세운** 을 새로 추가하려는데 cache 무효화는 어떻게 처리해요?"
> **Domain expert**: "**캐시-리딩 모듈** 이 처리합니다. caller 가 `buildYearlyPrompt` 결과에 **프롬프트 버전** 을 같이 넣고, 모듈이 cache row 의 `(model, promptVersion)` 과 비교해서 mismatch 면 새로 생성합니다. **결정적 계산** (`computeYearPillar`, `computeMonthPillars`) 은 caller 가 미리 돌려서 prompt builder 에 넘기세요."

> **Dev**: "**일진** 도 같은 모듈을 써요?"
> **Domain expert**: "네 — 단지 **일진** 은 LLM 결과를 JSON+Zod 로 검증하니까 validator 슬롯에 그 검증 함수를 넘기고, **섹션 리딩** 과 **세운** 은 markdown 그대로니까 identity validator 를 넘깁니다. 재시도(`retryWithEmphasis`)는 모듈이 아니라 일진 caller 가 try/catch 로 처리합니다."

> **Dev**: "**호스트** 의 docker context 가 끊겼을 때 컨테이너 목록은요?"
> **Domain expert**: "현재는 malformed JSON line 을 silent drop 하고 정상 결과만 반환합니다 — 친구션 #4 입니다. **호스트 카탈로그** 에서 호스트가 사라진 게 아니라 docker 응답이 깨진 거니까, 응답 셰이프에 누락 카운트가 들어가야 합니다."

## Flagged ambiguities

- **"풀이"** 는 사용자 발화에서 자주 쓰이지만 코드에서는 **리딩** 으로 통일.
- **"서비스"** 는 compose service 와 충돌하므로 호스트 인프라 도메인에서는 **프로젝트** 로 지칭.
- **"답장 필요"** 와 **"중요한 메시지"** 는 분류 기준이 다른 *직교* 개념 — 같은 스레드가 둘 다, 하나만, 또는 둘 다 아닐 수 있음.
