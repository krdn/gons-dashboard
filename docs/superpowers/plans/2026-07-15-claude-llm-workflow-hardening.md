# Claude LLM GitHub Actions Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate Claude Code execution behind an exact repository-permission check so untrusted callers never receive CLIProxyAPI secrets or repository write permissions.

**Architecture:** A secret-free `authorize` job checks `github.actor` through GitHub's collaborator-permission API and emits a boolean output. The existing Claude job depends on that output, keeps the current CLIProxyAPI Secret names, and runs only for `admin`, `maintain`, or `write` actors with all external actions pinned to full commit SHAs.

**Tech Stack:** GitHub Actions YAML, GitHub CLI (`gh`), Bash, `anthropics/claude-code-action`, CLIProxyAPI via `ANTHROPIC_BASE_URL`

## Global Constraints

- Modify only `.github/workflows/claude-llm.yml` for runtime behavior; update the approved design document status only after verification.
- Preserve the existing events: `issue_comment: created`, `pull_request_review_comment: created`, and `issues: opened, assigned`.
- Preserve the existing Secret names: `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL_NAME`.
- Only `admin`, `maintain`, and `write` repository permissions may reach the secret-bearing Claude job.
- Permission lookup errors and unexpected responses must fail closed.
- Keep `timeout-minutes: 20` on Claude execution and add `--max-turns 10`.
- Keep `show_full_output: false` and do not add arbitrary Bash tools to Claude.
- Pin every external `uses:` reference to a verified full 40-character commit SHA with a human-readable version comment.
- Do not add Dependabot, alter CLIProxyAPI/Nginx, or change Max/OAuth authentication behavior.

---

## File Structure

- Modify: `.github/workflows/claude-llm.yml` — event filtering, permission authorization, and secret-bearing Claude execution.
- Modify: `docs/superpowers/specs/2026-07-15-claude-llm-workflow-hardening-design.md` — change status from user review to implemented only after all checks pass.

### Task 1: Gate and Harden the Claude Workflow

**Files:**
- Modify: `.github/workflows/claude-llm.yml:1`
- Modify: `docs/superpowers/specs/2026-07-15-claude-llm-workflow-hardening-design.md:5`

**Interfaces:**
- Consumes: GitHub event context (`github.event_name`, event body/title, `github.actor`, `github.repository`, `github.token`) and existing repository Secrets (`LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL_NAME`).
- Produces: `needs.authorize.outputs.authorized` as the only gate into `claude_run`; approved actors receive the existing Claude behavior, while other actors never enter the secret-bearing job.

- [ ] **Step 1: Run the security invariant check and verify the current workflow fails it**

Run:

```bash
bash -euo pipefail -c '
file=.github/workflows/claude-llm.yml
test "$(rg -c "uses: [^ ]+@[0-9a-f]{40}" "$file")" -eq 2
rg -q "^  authorize:" "$file"
rg -q "needs: authorize" "$file"
rg -q "needs\\.authorize\\.outputs\\.authorized == .true." "$file"
rg -q -- "--max-turns 10" "$file"
rg -q "show_full_output: false" "$file"
'
```

Expected: FAIL before reaching all assertions. The current file contains `actions/checkout@v6` and `anthropics/claude-code-action@v1` and has no `authorize` job.

- [ ] **Step 2: Replace the workflow with the approved permission-gated implementation**

Replace `.github/workflows/claude-llm.yml` with:

```yaml
name: Claude Code Custom LLM Integration

on:
  issue_comment:
    types: [created] # 이슈나 PR에 댓글이 달릴 때 실행
  pull_request_review_comment:
    types: [created] # PR diff 라인 댓글
  issues:
    types: [opened, assigned] # 이슈 생성/할당

jobs:
  authorize:
    # @claude가 포함된 요청만 최소 권한 job에서 호출자 권한을 확인한다.
    if: |
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@claude')) ||
      (github.event_name == 'pull_request_review_comment' && contains(github.event.comment.body, '@claude')) ||
      (github.event_name == 'issues' && (contains(github.event.issue.body, '@claude') || contains(github.event.issue.title, '@claude')))
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: read
    outputs:
      authorized: ${{ steps.permission.outputs.authorized }}

    steps:
      - name: Check actor repository permission
        id: permission
        shell: bash
        env:
          GH_TOKEN: ${{ github.token }}
          REPOSITORY: ${{ github.repository }}
          ACTOR: ${{ github.actor }}
        run: |
          set -euo pipefail

          permission="$(gh api \
            -H "Accept: application/vnd.github+json" \
            -H "X-GitHub-Api-Version: 2022-11-28" \
            "repos/${REPOSITORY}/collaborators/${ACTOR}/permission" \
            --jq ".permission")"

          case "${permission}" in
            admin|maintain|write)
              echo "authorized=true" >> "${GITHUB_OUTPUT}"
              ;;
            read|triage|none)
              echo "authorized=false" >> "${GITHUB_OUTPUT}"
              echo "::notice title=Claude invocation denied::${ACTOR} has ${permission} permission."
              ;;
            *)
              echo "::error title=Permission lookup failed::Unexpected permission '${permission}' for ${ACTOR}."
              exit 1
              ;;
          esac

  claude_run:
    needs: authorize
    if: needs.authorize.outputs.authorized == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 20
    permissions:
      contents: write # 브랜치 생성/커밋
      pull-requests: write # PR 코멘트·생성
      issues: write # 이슈 코멘트
      id-token: write # 기본 Claude GitHub App 인증
      actions: read # PR CI 결과 조회

    steps:
      - name: Checkout Code
        uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3
        with:
          fetch-depth: 1

      - name: Run Claude Code with CLIProxyAPI
        uses: anthropics/claude-code-action@f1bd27ca5b54584506e40e17884d90bdaaa1a9b3 # v1.0.173
        with:
          # CLIProxyAPI의 top-level api-keys 중 이 저장소 전용 키
          anthropic_api_key: ${{ secrets.LLM_API_KEY }}
          additional_permissions: |
            actions: read
          show_full_output: false
          claude_args: |
            --model ${{ secrets.LLM_MODEL_NAME }}
            --max-turns 10
        env:
          ANTHROPIC_BASE_URL: ${{ secrets.LLM_BASE_URL }}
```

- [ ] **Step 3: Format the workflow with the repository's installed Prettier**

Run:

```bash
pnpm --dir apps/dashboard exec prettier --write ../../.github/workflows/claude-llm.yml
```

Expected: `.github/workflows/claude-llm.yml` is formatted successfully.

- [ ] **Step 4: Run the complete static security invariant check**

Run:

```bash
bash -euo pipefail -c '
file=.github/workflows/claude-llm.yml
test "$(rg -c "uses: [^ ]+@[0-9a-f]{40}" "$file")" -eq 2
! rg -n "uses: [^ ]+@(main|master|v[0-9]+)([[:space:]#]|$)" "$file"
rg -q "^  authorize:" "$file"
rg -q "needs: authorize" "$file"
rg -q "needs\\.authorize\\.outputs\\.authorized == .true." "$file"
rg -q "admin|maintain|write" "$file"
rg -q -- "--max-turns 10" "$file"
rg -q "show_full_output: false" "$file"
authorize_block="$(sed -n "/^  authorize:/,/^  claude_run:/p" "$file")"
! grep -q "secrets\\." <<<"$authorize_block"
! grep -Eq "(contents|pull-requests|issues): write" <<<"$authorize_block"
'
```

Expected: PASS with exit code 0 and no moving-tag matches.

- [ ] **Step 5: Validate YAML formatting and whitespace**

Run:

```bash
pnpm --dir apps/dashboard exec prettier --check ../../.github/workflows/claude-llm.yml
git diff --check
```

Expected: Prettier reports that the workflow uses the configured style, and `git diff --check` exits 0 with no output.

- [ ] **Step 6: Review the exact permission and Secret boundary in the diff**

Run:

```bash
git diff -- .github/workflows/claude-llm.yml
```

Expected review findings:

- `authorize` has only `contents: read` and no `secrets.*` references.
- `claude_run` has `needs: authorize` and the `authorized == 'true'` condition.
- Only `claude_run` references the three `LLM_*` Secrets.
- Both `uses:` entries contain 40-character SHAs and version comments.
- No `allowed_non_write_users`, wildcard bots, arbitrary Bash tools, or full-output logging is enabled.

- [ ] **Step 7: Mark the approved design as implemented after verification**

Change the status line in `docs/superpowers/specs/2026-07-15-claude-llm-workflow-hardening-design.md` to:

```markdown
- **상태**: 구현 완료
```

- [ ] **Step 8: Re-run final verification over both changed files**

Run:

```bash
bash -euo pipefail -c '
file=.github/workflows/claude-llm.yml
test "$(rg -c "uses: [^ ]+@[0-9a-f]{40}" "$file")" -eq 2
rg -q "^  authorize:" "$file"
rg -q "needs\\.authorize\\.outputs\\.authorized == .true." "$file"
rg -q -- "--max-turns 10" "$file"
rg -q "show_full_output: false" "$file"
rg -q "^- \\*\\*상태\\*\\*: 구현 완료$" docs/superpowers/specs/2026-07-15-claude-llm-workflow-hardening-design.md
'
pnpm --dir apps/dashboard exec prettier --check ../../.github/workflows/claude-llm.yml
git diff --check
git status --short
```

Expected: all assertions and formatting checks pass; status shows the hardened workflow plus the design status change and this implementation plan if it is not yet committed.

- [ ] **Step 9: Commit the verified implementation**

Run:

```bash
git add .github/workflows/claude-llm.yml \
  docs/superpowers/specs/2026-07-15-claude-llm-workflow-hardening-design.md \
  docs/superpowers/plans/2026-07-15-claude-llm-workflow-hardening.md
git commit -m "ci: harden Claude LLM workflow authorization"
```

Expected: one focused commit containing the workflow, implementation plan, and final design status.

## Manual Smoke Test After Push

The local workspace cannot reproduce GitHub's event identity, repository permission API, repository Secrets, or the hosted CLIProxyAPI request. After pushing the commit:

1. A `write` user comments `@claude` on a test issue; `authorize` and `claude_run` should both run.
2. A `read` or external user comments `@claude`; only `authorize` should run and `claude_run` should be skipped.
3. Confirm that Actions logs do not contain `LLM_API_KEY`, `LLM_BASE_URL`, OAuth material, or full Claude tool output.
4. Confirm that the approved run reaches CLIProxyAPI and posts the expected issue comment or PR response.
