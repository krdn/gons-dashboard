// 오늘의 운세 정적 스냅샷.
//
// PlayMCP `1fate-get_daily_fortune` 서버 버그(longitude undefined)로 인해
// 어제(2026-05-12 00:13) 세션에서 도출한 분석 결과를 그대로 캐싱.
// 매일 갱신하려면 Claude Code 세션에서 새 운세를 받아 이 파일을 교체하면 됨.

export interface FortuneScore {
  label: string;
  score: number; // 1~5
  note: string;
}

export interface FortuneHourSlot {
  range: string;
  vibe: string;
  isGolden?: boolean;
}

export interface FortuneRemedy {
  colors: string[];
  directions: string[];
  foods: string[];
  items: string[];
}

export interface FortuneData {
  forDate: string; // YYYY-MM-DD (KST)
  dayPillar: string; // 일진 e.g. "戊申"
  summary: string;
  overallScore: number; // 1~5
  scores: FortuneScore[];
  hourly: FortuneHourSlot[];
  recommendations: string[];
  cautions: string[];
  remedy: FortuneRemedy;
  closing: string;
}

export const FORTUNE_FOR_TODAY: FortuneData = {
  forDate: "2026-05-13",
  dayPillar: "戊申",
  summary:
    "戊土 상관(傷官)과 申金 정재(正財)가 동시에 작동하는 날. 표현·실행이 살아나고 작게라도 손에 쥐는 결실이 어울리는 흐름.",
  overallScore: 4,
  scores: [
    {
      label: "재물",
      score: 4,
      note: "申金 정재가 자리를 잡아 정해진 수입·계약 흐름에 유리. 큰 베팅보다 회수가 명확한 거래.",
    },
    {
      label: "일",
      score: 4,
      note: "戊土 상관이 표현·아이디어를 끌어올림. 새 제안서·발표·정리 업무에 적기.",
    },
    {
      label: "관계",
      score: 3,
      note: "말이 앞서면 오해 — 듣기 6, 말하기 4의 비율로. 윗사람과는 격식 유지.",
    },
    {
      label: "건강",
      score: 3,
      note: "土 과다 우려 — 소화기·과식 주의. 가벼운 산책으로 기운 풀기.",
    },
    {
      label: "학습",
      score: 4,
      note: "기록과 정리가 잘 붙음. 미뤄둔 메모를 묶어두기 좋은 날.",
    },
  ],
  hourly: [
    { range: "05–07", vibe: "조용한 시작 — 명상·산책" },
    { range: "07–09", vibe: "정리·메일 회신" },
    { range: "09–11", vibe: "집중 작업 1차" },
    { range: "11–13", vibe: "가벼운 식사·짧은 미팅" },
    { range: "13–15", vibe: "정체 구간 — 단순 처리" },
    {
      range: "15–17",
      vibe: "황금시간 — 申金 정재 작동, 결정·체결·실행",
      isGolden: true,
    },
    { range: "17–19", vibe: "정리·다음날 계획" },
    { range: "19–21", vibe: "관계 — 가까운 사람과 짧게" },
  ],
  recommendations: [
    "오늘 안에 마무리 가능한 작업 한 가지를 골라 끝까지 매듭짓기",
    "지출·수입을 장부에 기록 — 정재가 작동할 때 흐름을 가시화",
    "15–17시 사이에 핵심 결정·계약·발송 처리",
    "글이나 메모로 생각을 외부화 (상관의 표현력 활용)",
  ],
  cautions: [
    "큰 투자·새 사업 계약은 신중 — 정재는 안정형, 모험형 아님",
    "말로 인한 오해 — 특히 윗사람·고객에게 격식 유지",
    "과식·기름진 음식 (土 과다일에 위장 부담)",
    "약속 시간 늦지 않기 — 申金은 시간 약속에 민감",
  ],
  remedy: {
    colors: ["흰색", "은색", "베이지"],
    directions: ["서쪽", "서남쪽"],
    foods: ["흰살생선", "두부", "배·무"],
    items: ["은제 액세서리", "흰 손수건", "메모장"],
  },
  closing:
    "호(虎)가 보니 오늘은 작게 매듭짓고 정확히 기록하는 날. 새로 벌이지 말고, 이미 벌인 일을 정돈하면 다음 주 흐름이 한결 가벼워진다.",
};

// birthDate ('YYYY-MM-DD') → FortuneData 매핑.
// 위젯 셀렉터가 선택된 프로필의 birthDate로 lookup. 없으면 "데이터 없음" 안내.
// PlayMCP 1fate-get_daily_fortune 서버 버그가 풀리거나 자체 사주 로직이 들어오면
// 이 Record를 함수 호출로 갈아끼우면 됨.
export const FORTUNE_DATA_BY_BIRTH: Record<string, FortuneData> = {
  "1967-03-29": FORTUNE_FOR_TODAY,
};
