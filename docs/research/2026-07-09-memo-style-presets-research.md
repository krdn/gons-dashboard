# 메모 AI 정리 방식(스타일 프리셋) 리서치

- 날짜: 2026-07-09
- 배경: 음성/텍스트 메모(`feat/voice-text-memo`)의 AI 정리가 현재 "군말 제거+문장부호"
  단일 모드(뜻 보존 최우선, 요약·재작성 금지)로 고정되어 있음. 사용자 요구:
  "메모된 문장을 다양한 방식으로 정리하고 싶다."
- 조사 범위: 3각 병렬 리서치
  - 음성메모 AI 전문 제품 8종: AudioPen, Voicenotes.ai, superwhisper, TalkNotes,
    Letterly, Whisper Memos, Cleft, Oasis AI
  - 빅테크 5종: Apple Intelligence Writing Tools, Notion AI, Samsung Galaxy AI
    (Note Assist / Transcript Assist), Google Pixel Recorder, OneNote Copilot
  - 오픈소스 7종: Scriberr, VoiceInk, open-whisper, Obsidian Copilot,
    Obsidian Text Generator, logseq-gpt3-openai, Reflect(+usememos 반례)

## 1. 업계 수렴 패턴 (핵심 결론)

1. **원문 불변 + 변환본 병존.** 원문 transcript는 절대 교체하지 않고, 정리본은
   파생 산출물로 나란히 보관 (Letterly 버전 스와이프, Oasis 산출물 N개 전부 유지,
   Voicenotes의 노트 1 : creation N, Scriberr의 별도 summaries 테이블).
   우리 `raw_content`/`cleaned_content` 1:1 구조의 자연스러운 다음 단계는
   **memo 1 : transformations N**.
2. **트리거는 "저장 후 온디맨드"가 표준.** 노트 보관형 제품 전부 + 빅테크 5종 전부가
   저장된 텍스트 위 버튼으로 실행. 녹음 전 모드 선택(superwhisper, Cleft)은
   dictation 유파라 저장형 메모에 부적합. open-whisper처럼 **이원화**(기본 정돈은
   자동, 추가 스타일은 온디맨드)가 기존 흐름을 깨지 않는 확장 경로.
3. **코어 프리셋은 5~6종으로 수렴.** 교집합: Summary, To-do/Action items,
   Bullet/Structured, Clean Up(=우리 기존 기능), Key Points, Email.
   특히 **'할 일 추출'은 모든 제품에서 요약과 분리된 독립 프리셋** (Notion
   "Find action items", OneNote "Create to-do list", Voicenotes "To-do List").
   TalkNotes식 100+ 콘텐츠 제작 프리셋(블로그/뉴스레터/스크립트)은 개인 대시보드에 과잉.
4. **커스텀 프롬프트는 사실상 필수 기능** (전문 제품 8/8 지원). 단 정의 방식은
   3단계 스펙트럼: 하드코딩 enum → 빌트인 시드+사용자 CRUD(VoiceInk, Scriberr,
   Reflect clone-and-edit) → 완전 템플릿 파일(Obsidian). 우리 규모엔 가운데가 상한,
   Phase 1은 하드코딩으로 충분.
5. **2층 프롬프트 구조.** 공통 가드레일(뜻 보존·고유명사 불변)은 공용 시스템 프롬프트
   한 곳에 두고, 프리셋에는 스타일 지시만 담는 계층 분리 (VoiceInk
   `enhancementSystemTemplate`, Cleft "Your Rules").
6. **결과 처리 표준 버튼:** 미리보기 → Replace / Insert(별도 보관) / Try again
   (Notion·Samsung·Logseq 플러그인 공통). 자동 반영하는 제품은 없음 — 우리
   승인-후-저장 철학과 일치.
7. **입력 길이 가드가 관행:** Samsung 최소 200자, Pixel 5분~1시간. 짧은 메모에
   요약 버튼을 비활성화하는 식.

## 2. 프리셋 후보 카탈로그

| 계열 | 프리셋 | 하는 일 | 근거 |
|---|---|---|---|
| 교정 | **기본 정돈** (기존) | 군말 제거+문장부호, 뜻 보존 | Voicenotes "Clean Up", TalkNotes "Transcript" — 기존 기능을 프리셋 1번으로 흡수 |
| 교정 | 매끄럽게 다듬기 | 받아쓰기 오류 교정+문장 재작성, 정보는 전부 보존 | Notion "Improve writing", AudioPen 중간 강도 |
| 구조 | **요약** | 3~5문장 또는 불릿 요약 | 전 제품 공통 1위 |
| 구조 | **구조화** | 헤딩+불릿으로 재구성 | Samsung "Headers and bullets", Letterly "Structured Text" |
| 추출 | **할 일 추출** | 액션 아이템 체크리스트 | 전 제품에서 요약과 분리된 독립 프리셋 |
| 용도 | 일기체 | 정돈된 저널 형식 | TalkNotes "Journal" |
| 용도 | 이메일/메시지 초안 | 메모→발신 가능한 초안 | 전 제품 공통. 우리는 draft-reply 인프라 재사용 가능 |
| 용도 | 번역 | ko↔en 등 | Notion, Samsung |
| 커스텀 | 사용자 정의 | 저장 가능한 자유 프롬프트 | 8/8 제품 지원 — Phase 2 |

직교 축(프리셋과 독립, 후순위): 재작성 강도 슬라이더(AudioPen 3단계),
상시 규칙(Cleft "Your Rules" — 예: 항상 존댓말).

## 3. 구현 축 분석 및 권장안

### 축 1 — 실행 시점: 이원화 (권장)
- 녹음 종료 시 자동 "기본 정돈" — 현행 유지, 변경 없음.
- 저장 후 메모 상세에서 "다르게 정리" 버튼 → 프리셋 선택 → 미리보기 → 저장.
- 부수 효과: 현재 AI 정리가 전혀 없는 **텍스트 메모에도** 동일하게 적용됨.

### 축 2 — 저장 모델: 변환본 병존 테이블 (권장)
Scriberr 패턴:

```
memo_transformations (
  id uuid PK,
  memo_id uuid FK → memos ON DELETE CASCADE,
  preset text,          -- 'summary' | 'structured' | 'todos' | ...
  model text,           -- 감사용 (VoiceInk 패턴)
  content text,
  created_at timestamptz
)
```

- `raw_content`/`cleaned_content` 기존 컬럼 불변 — 마이그레이션은 순수 추가(0036).
- 메모 상세에서 원문/정돈본/변환본들을 탭(칩)으로 전환 (Letterly 스와이프의 탭 번역).
- 대안(비권장): `cleaned_content` 교체 — 마이그레이션 없지만 스타일 1개만 유지 가능,
  "다양한 방식" 요구와 충돌.

### 축 3 — 프리셋 정의: Phase 1 하드코딩 + 2층 프롬프트
- `features/memo-transform/lib/presets.ts`에 `{ id, label, prompt, minInputLen }` map.
- 공통 가드레일(고유명사·숫자·날짜 불변, 한국어 유지)은 공용 시스템 프롬프트로 분리.
- 사용자 정의 프리셋 CRUD(DB 시드+편집)는 요구가 생기면 Phase 2.

### 축 4 — 모델·비용
- `claude-sonnet-5` 유지. haiku는 cli-proxy 경유 비코딩 생성 거절 이력이 있어
  (이메일 초안 사고) 메모 변환에도 회피.
- 온디맨드 + 승인 기반이라 비용은 사용자 행동에 비례. `logLlmSpend`를
  `memo-transform:<preset>` 라벨로 프리셋별 집계.
- `MAX_INPUT 4_000` 가드 재사용. degenerate 검출은 프리셋별 조정 필요
  (요약은 축약이 정상이므로 기존 60% 규칙 적용 금지 — 프리셋별 검증 규칙).

### 축 5 — UX
- 결과 미리보기 + [저장 / 다시 생성 / 취소] — Notion·Logseq 3버튼 표준의 번역.
- 프리셋별 최소 길이 미달 시 버튼 비활성 (Samsung 200자 관행, 한국어 메모는
  요약 기준 ~80자 제안).

## 4. 단계 제안

- **Phase 1 (최소 가치):** 프리셋 3종 추가(요약·구조화·할 일 추출) +
  `memo_transformations` 테이블 + 메모 상세 온디맨드 변환 UI(미리보기 승인).
  기존 녹음-정돈 플로우는 무변경.
- **Phase 2 (확장):** 매끄럽게/일기체/이메일 초안/번역, 커스텀 프리셋 CRUD,
  재작성 강도, 상시 규칙.

## 5. 선행 조건

`feat/voice-text-memo` 브랜치에 미완 작업 잔존: 임시 디버그 로깅 제거
(createMemoAction.ts, cleanupTranscriptAction.ts) + `"use server"` 타입 재-export
fix 커밋 + 게이트 재실행. 이 확장은 해당 브랜치 마무리 후 별도
스펙(brainstorming → spec → plan) 및 브랜치로 진행.
