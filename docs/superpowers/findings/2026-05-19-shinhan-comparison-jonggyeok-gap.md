# 신한라이프 비교로 드러난 사주 알고리즘 갭 — 종격(從格) 판정 부재

- 작성일: 2026-05-19
- 작성자: gon + Claude Code
- 상태: FINDING (v0.3 진입 전 진단 문서)
- 트리거: 김석곤 1967-03-29 05:30 양력 남자 프로파일의 2026 세운 평가가 신한라이프와 정반대로 나오는 현상

## 1. 발견의 배경

v0.2 lifetime narrative richer 작업을 운영 배포한 직후, 사용자가 2026 세운에 대한 우리 시스템의 평가가 신한라이프와 정반대임을 보고. 신한라이프는 신한금융계열의 공식 사주 도구 (https://www.shinhanlife.co.kr/hp/cdhg0130.do) 로 비교 신뢰도 높음.

## 2. 비교 데이터 — 김석곤 1967-03-29 05:30 양력 남자

### 2.1 명조 4기둥 (양 시스템 완전 일치)

| | 年 | 月 | 日 | 時 |
|---|---|---|---|---|
| 천간 | 丁 | 癸 | **壬** (일간) | 癸 |
| 지지 | 未 | 卯 | 辰 | 卯 |

### 2.2 신강도 판정 비교

| 시스템 | 알고리즘 | 결과 |
|---|---|---|
| **신한라이프** | 가중치 점수 (월령·천간·지지 차등) | 23 : 127, **신약** |
| **우리 lifetime** (`elements.ts:computeStrength`) | 일간 오행 개수만 셈 | water = 3 → **strong** |
| **우리 yearly** (`adapters/ko/yongshin.ts:computeShenStrength`) | support 3 vs drain 5 자평 룰 | drain-support=2 → **신약** |

→ 우리 시스템 내부에서 lifetime 과 yearly 가 모순. 신한라이프는 yearly 와 일치.

### 2.3 오행 점수 (신한라이프 자체 계산)

| 木 | 火 | 土 | 金 | 水 |
|---|---|---|---|---|
| 72 | 19 | 36 | **0** | 23 |

- 인성(金) = 0
- 비겁(水) = 23
- 식상(木) = **72** (압도적)
- 재성(火) = 19
- 관성(土) = 36

### 2.4 대운 판정 (양 시스템 일치)

- 현재 대운: **丁酉 (58~67세)**

### 2.5 2026년 (丙午年) 평가

| 시스템 | 평가 | 한 줄 |
|---|---|---|
| **신한라이프** | "올해는 대단히 좋은 년도", "부자의 기반을 이루셔야 하는 년도" | "재정의 흐름이 매우 좋은 시기" |
| **우리 ko** | unfavorable | 火 강화 (기신) → 用神 金 약화 |
| **우리 cn-ziping** | unfavorable | 동일 논리 |
| **우리 cn-mangpai** | unfavorable | 응기 강력 (壞 방향) |
| **우리 jp** | mixed | 재·관·인 喜神 일부 hit |
| **PlayMCP (참고)** | 평(平) — neutral | "내실 다지기 좋은 해" |

## 3. 원인 분석

### 3.1 핵심 갭 — 종격(從格) 판정 부재

신한라이프가 "대단히 좋다" 로 판정한 정통 자평론 근거:
- 인성(金) = 0, 비겁(水) = 23 (약함), 식상(木) = 72 (압도적)
- 정통 분석으로는 **종아격(從兒格) 또는 가종(假從)** 후보 명조
- 종아격 = 식상을 따라가는 격국 → 食傷生財 (식상이 재성을 생함) 흐름이 길
- 2026 丙午年 (火 = 재성) → 식상(木)의 흐름이 재성(火)로 풀리는 길운

우리 시스템 (`adapters/{ko,cn-ziping}/yongshin.ts`) 의 신약 처리:
```typescript
} else if (verdict === "신약") {
  primary = PRODUCED_BY[dayElement];                  // 인성 무조건
  gisin = [PRODUCES[dayElement], CONTROLS[dayElement]]; // 식상·재성 무조건 기신
}
```

→ 신약이면 **무조건 인성 용신**. 종격 판정 분기 자체가 없음. 김석곤 같은 종아 후보 명조에 대해 정통 자평 분석과 정반대 결과를 산출.

### 3.2 부수적 갭 — 강약 가중치

신한라이프의 23:127 (5.5배 차이) 은 단순 개수가 아니라 가중치 점수. 우리의 단순 3:5 (1.67배 차이) 룰은:
- 월령 (월지의 오행 비중) 미반영
- 천간 vs 지지 차등 미반영
- 통근 (지지가 천간을 뿌리내림) 미반영

→ 신약 판정 자체는 우리도 맞추지만 *얼마나 심한 신약인지* 를 못 잡아내고, 그게 종격 후보 인식 실패로 직결.

### 3.3 격국-용신 일관성 부재

`saju_charts.pattern = '傷官格'` 으로 격국은 정확히 잡힘. 그러나 용신 계산이 격국과 *연동되지 않음*:
- 상관격 + 신약 → 정통 분기: **傷官佩印** (인성으로 상관을 제어) vs **傷官生財** (재성으로 상관을 흘림) vs **종아격** (상관을 따라감)
- 우리 코드는 격국 분기와 무관하게 일률적 "신약 → 인성" 처리

## 4. 내부 모순 (이전 진단의 항목 A) 와의 관계

이전에 발견한 lifetime 'strong' vs yearly '신약' 모순은 *증상* 이고, 이번 신한 비교로 드러난 **종격 부재 + 강약 가중치 부재** 가 *원인*. lifetime 의 단순 개수 룰은 빠르게 'strong' 으로 분류해 사용자 직관을 흐릴 뿐, 진짜 문제는 양쪽 모두 종격을 못 잡는다는 것.

## 5. v0.3 backlog (우선순위순)

### 우선순위 상

**[V0.3-A1] 종격(從格) 판정 룰 도입**
- 트리거 조건: 인성 = 0 + 비겁 ≤ N + 한 오행이 압도적 (>= 4글자 또는 점수 50%↑)
- 종아격/종재격/종살격 분기
- 종격 시 용신 = 그 압도 오행 자체 (식상/재성/관성 중 하나)
- 영향: lifetime + yearly + monthly + daily 모두

**[V0.3-A2] 격국-용신 분기 통합**
- 상관격 + 신약: 佩印 vs 生財 vs 종아 결정 로직
- 정관격 + 신약: 관인상생 강화
- 편관격 + 신약: 살인상생 강화
- 영향: 4학파 yongshin builder 전부

### 우선순위 중

**[V0.3-B1] 강약 점수 가중치 도입**
- 월령 오행: +3 (월지 = 출생 계절 = 명조의 본질)
- 일지: +2 (배우자궁, 일간의 직접 거처)
- 천간: +1
- 지지: +2
- 통근 보너스: 지지가 천간을 뿌리내릴 때 +1
- 결과를 23:127 형식의 비율로 표현 (신한라이프 호환)

**[V0.3-B2] lifetime/yearly strength 단일 알고리즘 통합**
- `elements.ts:computeStrength` 의 단순 개수 룰을 `adapters/*/yongshin.ts:computeShenStrength` 와 동일 알고리즘으로 통합
- `saju_charts.strength` 컬럼 의미 재정의 (또는 deprecated 후 새 컬럼)

### 우선순위 하

**[V0.3-C1] grade 척도 보정**
- 우리: favorable / unfavorable / mixed (3분)
- 신한·PlayMCP: 대길 / 길 / 평 / 흉 / 대흉 (5분)
- 5분 척도로 확장하면 사용자 체감 부정성 완화. 단 정통 자평론 기준이지 grade 만 바꾸는 *완곡 표현* 으로는 부족 — A1/A2 가 우선

**[V0.3-C2] 종격 판정 fixture 회귀 테스트**
- v0.2 yearly Phase 6 이 fixture 10건 회귀 보장한 패턴 차용
- 종격 후보 명조 fixture 추가 (김석곤 포함 종아 / 종재 / 종살 각 3건)

## 6. 즉시 조치 — 권고

종격 룰 도입은 명조 *알고리즘 자체* 의 깊이를 한 단계 올리는 작업이라 정식 v0.3 spec/plan/구현 사이클이 필요. 이번에는 이 finding 문서만 commit. v0.3 brainstorming 시작 시 이 문서를 입력 자료로 활용.

긴급 회피 (사용자 본인 화면을 바꾸려면):
- DB 의 김석곤 2026 row 수동 삭제 + narrative 캐시 삭제 → 다음 호출에서 재생성. 단 알고리즘이 안 바뀌었으니 같은 결과
- 또는 사용자에게 "현재 시스템은 종격 미반영, v0.3 에서 수정 예정" 안내

## 7. 참고

- 신한라이프 (참고용 비교): https://www.shinhanlife.co.kr/hp/cdhg0130.do
- PlayMCP 카카오 fate (참고용 비교): claude_ai_PlayMCP__1fate-get_year_fortune
- 우리 시스템 yongshin builder:
  - `packages/saju/src/adapters/ko/yongshin.ts`
  - `packages/saju/src/adapters/cn-ziping/yongshin.ts`
  - `packages/saju/src/adapters/cn-mangpai/yongshin.ts`
  - `packages/saju/src/adapters/jp/yongshin.ts`
- 우리 시스템 strength 계산:
  - `packages/saju/src/elements.ts:computeStrength` (lifetime, 단순 개수)
  - `packages/saju/src/adapters/ko/yongshin.ts:computeShenStrength` (yearly, 자평 룰)
- 관련 v0.2 spec/plan:
  - `docs/superpowers/specs/2026-05-19-saju-lifetime-narrative-richer-design.md`
  - `docs/superpowers/plans/2026-05-19-saju-lifetime-narrative-richer.md`
- 김석곤 일주 정정 메모리: `~/.claude/projects/-home-gon-projects-gon-gons-dashboard/memory/saju-G1-day-pillar-correction.md`
