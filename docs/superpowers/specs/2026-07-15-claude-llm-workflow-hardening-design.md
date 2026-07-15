# Claude LLM GitHub Actions 보안 강화 설계

- **날짜**: 2026-07-15
- **범위**: `.github/workflows/claude-llm.yml`
- **상태**: 설계 승인, 사용자 문서 검토 대기

## 목표

CLIProxyAPI(`ANTHROPIC_BASE_URL`)를 사용하는 Claude Code GitHub Action에서 승인된 저장소
사용자만 AI 작업을 시작하게 한다. 승인되지 않은 호출에는 프록시 키와 저장소 쓰기 권한을
노출하지 않으며, 외부 이슈와 PR은 관리자가 검토 후 직접 `@claude`로 호출할 수 있게 한다.

## 현재 상태와 문제

현재 워크플로는 이슈·PR 입력에 `@claude`가 있는지만 확인한다. Claude Code Action이 내부에서
쓰기 권한을 검사하지만, 그 전에 비밀정보를 받는 서드파티 액션 단계가 시작된다. 또한
`actions/checkout@v6`와 `anthropics/claude-code-action@v1`은 이동 가능한 태그이고, 실행 turn
상한이 없다.

## 결정 사항

| 항목 | 결정 |
|------|------|
| 호출 권한 | 이벤트를 발생시킨 `github.actor`가 `admin`, `maintain`, `write` 중 하나일 때만 허용 |
| 권한 검사 위치 | 비밀정보와 쓰기 권한이 없는 별도 `authorize` job |
| 외부 이슈·PR | 외부 작성자는 직접 호출 불가. 권한 있는 관리자가 `@claude`를 작성하면 처리 가능 |
| 인증 | 기존 `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL_NAME` Secret 이름 유지 |
| 액션 공급망 | 모든 외부 액션을 검증한 전체 40자리 커밋 SHA로 고정하고 태그를 주석으로 기록 |
| 실행 제한 | 기존 20분 timeout 유지, Claude에 `--max-turns 10` 적용 |
| 로그 | `show_full_output: false`를 명시해 도구 출력과 비밀정보 노출 위험 축소 |
| CI 조회 | `actions: read` 권한과 `additional_permissions: actions: read`를 함께 설정 |

## 아키텍처와 데이터 흐름

```text
GitHub 이벤트에서 @claude 감지
  -> authorize job
       - contents: read만 부여
       - 프록시/모델 Secret 없음
       - GitHub API로 github.actor의 저장소 권한 조회
       - admin/maintain/write만 authorized=true
  -> claude_run job (authorized=true일 때만)
       - 저장소 작업에 필요한 권한 부여
       - LLM_API_KEY와 ANTHROPIC_BASE_URL 전달
       - SHA 고정 Claude Code Action 실행
```

`issue_comment`와 `pull_request_review_comment`에서는 댓글 작성자가 `github.actor`다.
`issues: opened`에서는 이슈 작성자, `issues: assigned`에서는 할당 이벤트를 발생시킨 사용자가
`github.actor`다. 따라서 외부 사용자가 제목이나 본문에 `@claude`를 넣어 만든 이슈는 최초
`opened` 실행에서는 거부되지만, 관리자가 이후 할당하면 `assigned` 실행에서 처리할 수 있다.
관리자가 별도 `@claude` 댓글을 작성하는 경우에도 처리할 수 있다.

## 권한 검사

`authorize` job은 GitHub 러너에 기본 제공되는 `gh` CLI와 `GITHUB_TOKEN`으로
`repos/{owner}/{repo}/collaborators/{actor}/permission`을 조회한다. 응답의 `permission`이
`admin`, `maintain`, `write`인 경우에만 job output을 `true`로 설정한다.

- 권한 없음(`read`, `triage`, `none`)은 정상적인 거부로 처리하고 Claude job을 건너뛴다.
- API 오류, 예상하지 못한 응답, 빈 권한은 fail-closed로 `authorize` job을 실패시킨다.
- Secret은 `claude_run` job에만 참조하므로 거부된 호출에는 주입되지 않는다.
- Claude Code Action의 자체 쓰기 권한 검사도 제거하지 않아 2차 방어선으로 유지한다.

## Claude 실행 설정

`claude_run`은 `needs.authorize.outputs.authorized == 'true'`일 때만 실행한다. 기존 프록시
연결 방식은 유지한다.

- `anthropic_api_key`: CLIProxyAPI의 다운스트림 API 키인 `secrets.LLM_API_KEY`
- `ANTHROPIC_BASE_URL`: `secrets.LLM_BASE_URL`
- `--model`: `secrets.LLM_MODEL_NAME`
- `--max-turns 10`: 무한·과도 실행 방지
- `show_full_output: false`: 전체 세션과 도구 결과를 Actions 로그에 출력하지 않음

모델 이름과 URL은 원칙적으로 GitHub Variables로 옮길 수 있지만, 이번 변경에서는 기존
저장소 설정을 깨뜨리지 않기 위해 Secret 참조를 유지한다.

## 권한과 프롬프트 인젝션 경계

호출자를 제한해도 Claude가 읽는 외부 이슈·PR 내용까지 신뢰할 수 있게 되는 것은 아니다.
권한 있는 사용자가 외부 콘텐츠를 검토한 뒤 호출한다는 운영 규칙이 필요하다. 이번 변경은
외부 사용자의 직접 실행과 Secret 노출을 차단하지만, 입력 콘텐츠의 프롬프트 인젝션을
완전히 제거하지는 않는다.

임의 Bash 도구는 추가 허용하지 않는다. Claude Code Action의 기본 파일·GitHub 도구만
사용하며, 향후 Bash 허용이 필요하면 명령 단위 allowlist를 별도로 설계한다.

## 실패 처리

- 트리거 문구 없음: `authorize`부터 실행하지 않음.
- 권한 부족: `authorized=false`, Claude job 생략.
- GitHub 권한 조회 실패: `authorize` 실패, Claude job 생략.
- 프록시 또는 모델 오류: 기존 20분 timeout 안에서 Claude job 실패.
- 액션 업데이트: SHA 변경 PR에서 대응 태그와 upstream 변경 내용을 검토한 뒤 반영.

## 검증

1. YAML 파싱 및 `actionlint`로 워크플로 문법과 표현식을 검사한다.
2. `uses:`가 모두 전체 40자리 SHA인지 정적 확인한다.
3. `authorize` job에 `LLM_*` Secret과 쓰기 권한이 없음을 diff로 확인한다.
4. `claude_run`이 `authorized=true`에 의존하는지 확인한다.
5. 권한별 기대 동작을 검토한다.
   - `admin`/`maintain`/`write`: Claude 실행
   - `read`/`triage`/외부 사용자: Claude 생략
   - GitHub API 실패: Claude 생략
6. 가능한 경우 권한 있는 계정의 `@claude` 호출로 프록시 연결을 수동 smoke test한다.

## 범위 밖

- 외부 사용자를 위한 별도 읽기 전용 Claude 워크플로
- CLIProxyAPI 서버와 Nginx 설정 변경
- GitHub Secret/Variable 이름 변경
- Dependabot 설정 파일 추가
- Claude OAuth 또는 Max 플랜 인증 방식 변경
