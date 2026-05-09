# 트리아지 레이블

스킬은 다섯 가지 표준 트리아지 역할로 이슈를 분류합니다. 이 파일은 그 역할을 이 저장소에서 실제로 사용하는 레이블 문자열로 매핑합니다.

| 표준 역할          | 이 저장소의 레이블 | 의미                                              |
| ------------------ | ------------------ | ------------------------------------------------- |
| `needs-triage`     | `needs-triage`     | 메인테이너가 평가해야 함                          |
| `needs-info`       | `needs-info`       | 보고자에게 추가 정보 대기 중                      |
| `ready-for-agent`  | `ready-for-agent`  | 완전히 명세됨, AFK 에이전트가 바로 작업 가능       |
| `ready-for-human`  | `ready-for-human`  | 사람의 구현이 필요함                              |
| `wontfix`          | `wontfix`          | 작업하지 않을 이슈                                |

스킬이 어떤 역할을 언급하면 (예: "AFK-ready 트리아지 레이블을 적용하라"), 위 표의 해당 레이블 문자열을 사용합니다.

## 레이블 초기화

새 저장소이므로 GitHub에 레이블이 아직 없을 수 있습니다. 처음 트리아지를 시작할 때 다음 명령으로 레이블을 생성합니다:

```bash
gh label create needs-triage --description "메인테이너 평가 대기" --color "FBCA04"
gh label create needs-info --description "보고자 답변 대기" --color "D4C5F9"
gh label create ready-for-agent --description "AFK 에이전트 작업 가능" --color "0E8A16"
gh label create ready-for-human --description "사람 구현 필요" --color "1D76DB"
gh label create wontfix --description "작업하지 않음" --color "FFFFFF"
```

오른쪽 열을 다른 명명 규칙으로 바꾸고 싶다면 위 표와 명령을 함께 수정하세요.
