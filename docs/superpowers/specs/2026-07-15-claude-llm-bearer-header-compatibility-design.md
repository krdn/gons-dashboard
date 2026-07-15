# Claude LLM Bearer Header Compatibility Design

- **날짜**: 2026-07-15
- **상태**: 구현 완료
- **대상**: `.github/workflows/claude-llm.yml`

## 배경

PR #306 병합 후 실제 이슈 이벤트로 `@claude` smoke test를 실행했다. `authorize` job은
성공했지만 `claude_run`은 첫 모델 요청에서 `is_error:true`로 실패했다. 같은 실행을
GitHub debug logging으로 재실행해도 동일하게 재현됐다.

CLIProxyAPI 외부 경로를 분리해 확인한 결과는 다음과 같다.

- 외부용 강력 키를 `Authorization: Bearer`로 보내면 `/v1/models`가 HTTP 200이다.
- 같은 키를 `x-api-key`로 보내면 Nginx가 HTTP 403을 반환한다.
- Bearer 방식의 `/v1/messages` 호출은 Claude Max OAuth를 통해 `PROXY_OK`를 반환한다.

따라서 CLIProxyAPI와 Max OAuth는 정상이며, Claude Code가 `ANTHROPIC_API_KEY`를
`x-api-key`로 보내는 방식과 Nginx의 Bearer 전용 입구 정책 사이의 헤더 불일치가
실패 원인이다.

## 목표

- Nginx의 외부용 강력 키 전용 정책을 유지한다.
- 기존 GitHub Secret 이름과 값을 변경하지 않는다.
- Claude Code Action이 외부 프록시 요청에 Bearer 헤더를 함께 보내게 한다.
- 기존 권한 게이트, SHA 고정, turn 제한, 전체 출력 억제를 유지한다.

## 검토한 접근

### 1. 워크플로에서 Bearer 커스텀 헤더 추가 — 채택

핀 고정된 Claude Code Action은 `ANTHROPIC_CUSTOM_HEADERS`를 Claude Code 프로세스로
전달한다. Anthropic SDK는 이 값을 줄별 `Header: value` 형식으로 파싱하므로 다음 환경
변수 하나를 추가한다.

```yaml
ANTHROPIC_CUSTOM_HEADERS: "Authorization: Bearer ${{ secrets.LLM_API_KEY }}"
```

Nginx와 CLIProxyAPI 설정을 바꾸지 않고 현재 외부 인증 경계를 그대로 사용할 수 있다.

### 2. Nginx가 `x-api-key`도 허용 — 미채택

동작은 가능하지만 운영 서버 설정 변경과 별도 배포가 필요하고, 현재 Bearer 전용 경계를
넓힌다. GitHub 워크플로만의 호환성 문제를 해결하기에는 범위가 크다.

### 3. Nginx의 앞단 키 검증 제거 — 미채택

내부용 약한 키까지 외부에 노출될 수 있어 보안 요구사항에 맞지 않는다.

## 설계

`claude_run`의 기존 Action step `env`에 `ANTHROPIC_CUSTOM_HEADERS`를 추가한다.

```yaml
env:
  ANTHROPIC_BASE_URL: ${{ secrets.LLM_BASE_URL }}
  ANTHROPIC_CUSTOM_HEADERS: "Authorization: Bearer ${{ secrets.LLM_API_KEY }}"
```

요청 흐름은 다음과 같다.

1. 기존 `authorize` job이 호출자의 저장소 권한을 검사한다.
2. 승인된 호출자만 `claude_run`에 진입한다.
3. Action은 `LLM_API_KEY`를 기존 `ANTHROPIC_API_KEY`와 Bearer 커스텀 헤더에 사용한다.
4. Nginx는 Bearer 헤더의 외부용 강력 키를 검증한다.
5. CLIProxyAPI가 동일 키를 검증하고 Claude Max OAuth 요청을 처리한다.

새 Secret은 만들지 않는다. Secret 참조는 계속 `claude_run`에만 존재하며
`show_full_output: false`를 유지한다.

## 실패 처리와 보안

- Secret이 내부용 키이거나 잘못된 값이면 Nginx가 계속 403으로 닫힌다.
- Nginx 또는 프록시가 실패하면 기존 20분 timeout 안에서 job이 실패한다.
- 로그에서 `LLM_API_KEY`, 모델명, Base URL이 마스킹되는지 재확인한다.
- `authorize` job에는 커스텀 헤더나 Secret 참조를 추가하지 않는다.
- Nginx 설정, CLIProxyAPI 설정, OAuth 토큰 파일은 변경하지 않는다.

## 검증

1. 변경 전 실제 GitHub Actions 실행 실패를 RED 증거로 사용한다.
2. 정적 검사로 커스텀 헤더가 정확히 한 번 존재하고 `LLM_API_KEY`를 사용하는지 확인한다.
3. `authorize` 블록에 Secret과 쓰기 권한이 없는지 재검사한다.
4. Prettier YAML 파싱·형식 검사와 `git diff --check`를 실행한다.
5. 변경을 원격 `main`에 반영한 뒤 임시 이슈에서 `@claude`를 다시 호출한다.
6. `authorize`와 `claude_run`이 모두 성공하고 Claude 댓글이 생성되는지 확인한다.
7. Actions 로그에 Secret과 전체 Claude 출력이 노출되지 않는지 확인한다.

## 롤백

문제가 생기면 `ANTHROPIC_CUSTOM_HEADERS` 한 줄만 제거한다. 기존 Nginx와 프록시 설정은
변경하지 않으므로 별도 운영 롤백은 필요 없다.

## 범위 밖

- Nginx 인증 규칙 변경
- CLIProxyAPI `config.yaml` 또는 OAuth 토큰 변경
- GitHub Secret 회전 또는 이름 변경
- 승인되지 않은 사용자의 호출 정책 변경
