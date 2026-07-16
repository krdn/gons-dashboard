import type { MemoHelpGuide } from "./types";

// 메모 도움말 콘텐츠 — 구현 사실만 기술한다 (계획·미구현 기능 금지).
// 기능이 바뀌면 이 파일만 고친다. 서술 근거가 되는 코드 위치는 각 항목 주석 참조.
export const MEMO_HELP_GUIDE: MemoHelpGuide = {
  quickStart: [
    "메모 페이지 상단 입력창에서 [음성]·[텍스트] 탭 중 하나를 고릅니다.",
    "말하거나 적은 뒤 저장하면 AI가 정리본을 만들고 잠시 후 카테고리 배지가 붙습니다.",
    "필요할 때 검색창·카테고리 칩으로 찾고, 카드에서 요약·이메일 초안 같은 AI 변환을 실행합니다.",
  ],
  chapters: [
    { id: "capture", title: "기록하기", tagline: "생각나는 즉시 말하거나 적습니다.", inFlow: true },
    { id: "auto", title: "정리는 자동", tagline: "저장만 하면 시스템이 다듬고 분류합니다.", inFlow: true },
    { id: "use", title: "꺼내 쓰기", tagline: "찾고, 변환하고, 할 일로 만듭니다.", inFlow: true },
    { id: "review", title: "돌아보기", tagline: "잊고 있던 메모가 알아서 돌아옵니다.", inFlow: true },
    { id: "manage", title: "관리", tagline: "편집·삭제와 설정 화면들입니다.", inFlow: false },
  ],
  features: [
    // ── 기록하기 ── MemoComposer (features/memo-compose)
    {
      id: "voice-memo",
      chapterId: "capture",
      icon: "🎙",
      title: "음성 메모",
      summary: "말하면 받아쓰고, AI가 정리한 미리보기를 승인해 저장합니다.",
      steps: [
        "[음성] 탭에서 녹음을 시작하고 말합니다.",
        "녹음을 끝내면 AI가 받아쓴 원문을 자동으로 정리합니다.",
        "미리보기에서 정리본을 확인·수정한 뒤 저장을 승인합니다.",
      ],
      tips: [
        "음성 탭은 브라우저가 음성 인식을 지원할 때만 나타납니다 — 미지원 브라우저에서는 텍스트 탭만 보입니다.",
        "승인 전 초안은 브라우저에 자동 보관됩니다. 새로고침하거나 이탈해도 복원 배너로 이어서 작성할 수 있습니다.",
        "AI 정리가 실패하면 원문 그대로 저장하거나 [다시 정리]로 재시도할 수 있습니다.",
      ],
    },
    {
      id: "text-memo",
      chapterId: "capture",
      icon: "⌨️",
      title: "텍스트 메모",
      summary: "타이핑으로 빠르게 적어 저장합니다 (최대 20,000자).",
      steps: ["[텍스트] 탭에서 내용을 입력합니다.", "저장을 누르면 즉시 목록에 나타납니다."],
    },
    // ── 정리는 자동 ── cleanupTranscript / classifyMemo + cron memo-classify
    {
      id: "ai-cleanup",
      chapterId: "auto",
      icon: "✨",
      title: "AI 정리본",
      auto: true,
      summary: "받아쓴 원문의 군더더기를 정리한 정리본을 만들어 줍니다.",
      steps: [
        "음성 메모를 저장하면 정리본이 기본 뷰가 됩니다.",
        "원문은 그대로 보존됩니다 — 카드의 [원문] 칩으로 언제든 원래 발화를 확인합니다.",
      ],
    },
    {
      id: "auto-classify",
      chapterId: "auto",
      icon: "🏷",
      title: "카테고리 자동 분류",
      auto: true,
      summary: "저장 직후 백그라운드에서 글의 종류를 분류해 배지를 붙입니다.",
      steps: [
        "저장하고 몇 초 뒤 카드에 카테고리 배지가 나타납니다.",
        "놓친 메모는 매시간 자동으로 다시 분류됩니다.",
        "기본 6종(아이디어·할 일·일기·참고·초안·기타) 외에 필요한 태그는 자동으로 새로 등록됩니다.",
      ],
      tips: [
        "배지를 눌러 직접 바꿀 수 있습니다 — 직접 고른 카테고리는 자동 분류가 절대 덮어쓰지 않습니다.",
      ],
    },
    // ── 꺼내 쓰기 ── SearchableMemoList / TransformDialog / memo-actions
    {
      id: "search-filter",
      chapterId: "use",
      icon: "🔍",
      title: "검색과 카테고리 필터",
      summary: "제목·원문·정리본·AI 변환본까지 한 번에 검색합니다.",
      steps: [
        "검색창에 단어를 입력합니다 — 공백으로 여러 단어를 적으면 모두 포함된 메모만 나옵니다.",
        "카테고리 칩을 눌러 특정 분류만 봅니다. 검색어와 조합할 수 있습니다.",
      ],
      tips: ["결과는 최신순 50건까지 표시되고, 더 있으면 절단 안내가 나타납니다."],
    },
    {
      id: "ai-transform",
      chapterId: "use",
      icon: "🪄",
      title: "AI 변환 (스타일 프리셋)",
      summary: "메모 하나를 요약·이메일 초안 등 다른 스타일의 글로 변환합니다.",
      steps: [
        "메모 카드에서 AI 정리 다이얼로그를 엽니다.",
        "스타일을 고릅니다 — 기본 7종: 정돈·매끄럽게·요약·구조화·할 일 추출·일기체·이메일 초안.",
        "변환 결과는 메모에 저장되어 카드의 변환본 칩으로 다시 열람합니다.",
      ],
      tips: [
        "나만의 프리셋과 기본 AI 모델은 설정 페이지에서 등록·변경합니다.",
        "원문이 아주 길면 앞부분(4,000자)만 변환되고 안내가 표시됩니다.",
      ],
      link: { href: "/memos/settings", label: "AI 정리 설정 열기" },
    },
    {
      id: "action-items",
      chapterId: "use",
      icon: "✅",
      title: "할 일·일정 추출",
      auto: true,
      summary: "최근 메모에서 할 일(todo)과 일정(event)을 자동으로 제안합니다.",
      steps: [
        "새 메모가 저장되면 시스템이 할 일·일정 후보를 추출해 제안합니다.",
        "제안을 수락하면 진행 항목이 되고, 완료 처리하거나 무시할 수 있습니다.",
      ],
      tips: [
        "오래된 메모는 대상이 아닙니다 — '다음 주 화요일' 같은 상대 날짜의 기준이 어긋나기 때문입니다.",
        "알림을 허용해 두면 마감이 다가올 때 웹 푸시로 리마인드합니다.",
      ],
    },
    // ── 돌아보기 ── memo-digest cron / insights
    {
      id: "weekly-digest",
      chapterId: "review",
      icon: "📬",
      title: "주간 다이제스트와 재부상",
      auto: true,
      summary: "매주 지난주 메모를 3~6줄로 요약해 홈 대시보드 카드로 보여줍니다.",
      steps: [
        "홈 대시보드의 다이제스트 카드에서 지난주 요약을 읽습니다.",
        "예전에 쓴 메모가 함께 다시 떠올라(재부상) 잊힌 생각을 상기시킵니다.",
      ],
    },
    {
      id: "insights",
      chapterId: "review",
      icon: "📈",
      title: "인사이트 대시보드",
      summary: "작성 활동 히트맵·연속 기록·카테고리 분포·변환 사용 현황을 봅니다.",
      steps: [
        "메모 페이지 상단의 [인사이트]로 이동합니다.",
        "히트맵에서 기록 습관을, 분포 차트에서 무엇을 많이 적는지 확인합니다.",
      ],
      link: { href: "/memos/insights", label: "인사이트 열기" },
    },
    // ── 관리 ── MemoCard 편집/삭제, settings, architecture
    {
      id: "edit-delete",
      chapterId: "manage",
      icon: "✏️",
      title: "편집과 삭제",
      summary: "카드에서 제목·정리본을 고치고, 삭제는 두 번 눌러 확정합니다.",
      steps: [
        "카드의 [편집]으로 제목과 정리본을 수정합니다.",
        "삭제는 실수 방지를 위해 2단계입니다 — [삭제]를 누르면 '정말 삭제?'로 바뀌고 3초 안에 한 번 더 눌러야 지워집니다.",
      ],
      tips: ["삭제하면 그 메모의 AI 변환본과 추출된 할 일·일정도 함께 사라집니다."],
    },
    {
      id: "settings-pages",
      chapterId: "manage",
      icon: "⚙️",
      title: "설정과 시스템 구조",
      summary: "AI 정리 설정에서 프리셋·기본 모델을, 시스템 구조에서 내부 동작을 봅니다.",
      steps: [
        "[AI 정리 설정]: 나만의 변환 프리셋 등록·수정, 기본 AI 모델 선택.",
        "[시스템 구조]: 메모 시스템의 내부 워크플로우 지도 — 유지보수·개발 참고용.",
      ],
      link: { href: "/memos/settings", label: "AI 정리 설정 열기" },
    },
  ],
};
