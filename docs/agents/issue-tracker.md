# 이슈 트래커: GitHub

이 저장소의 이슈와 PRD는 GitHub Issues에 저장됩니다. 모든 작업은 `gh` CLI로 수행합니다.

저장소: `krdn/gons-dashboard`

## 컨벤션

- **이슈 생성**: `gh issue create --title "..." --body "..."` — 여러 줄 본문은 heredoc 사용
- **이슈 조회**: `gh issue view <번호> --comments` — 필요한 필드는 `jq`로 필터링하고 레이블도 함께 가져옴
- **이슈 목록**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` — 적절한 `--label`, `--state` 필터 적용
- **이슈에 댓글 달기**: `gh issue comment <번호> --body "..."`
- **레이블 추가/제거**: `gh issue edit <번호> --add-label "..."` / `--remove-label "..."`
- **이슈 종료**: `gh issue close <번호> --comment "..."`

저장소는 `git remote -v`로 자동 추론됩니다. 클론 디렉토리 안에서 `gh`를 실행하면 자동으로 인식합니다.

## 이슈 작성 규칙

- **제목**: 한국어로 작성, 50자 이내, 명령문 형태 (예: "이메일 요약 카드 컴포넌트 추가")
- **본문**: 한국어로 작성, 다음 섹션 포함 권장
  - **배경 / Why**: 왜 이 작업이 필요한가
  - **요구사항 / What**: 무엇을 만들 것인가 (수락 기준 포함)
  - **참고 / References**: 관련 ADR, 디자인 문서, 외부 자료

## 스킬이 "이슈 트래커에 게시"라고 말할 때

GitHub 이슈를 생성합니다.

## 스킬이 "관련 티켓을 가져와라"라고 말할 때

`gh issue view <번호> --comments`를 실행합니다.
