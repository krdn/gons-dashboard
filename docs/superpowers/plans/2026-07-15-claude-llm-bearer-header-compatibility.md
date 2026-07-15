# Claude LLM Bearer Header Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the merged Claude GitHub Action pass the Bearer-only Nginx gateway and prove the fix with a real `@claude` issue smoke test.

**Architecture:** Keep the existing `anthropic_api_key` input and Nginx policy unchanged. Add one `ANTHROPIC_CUSTOM_HEADERS` environment variable to the secret-bearing Action step so the Anthropic SDK sends the same repository Secret as `Authorization: Bearer`, then validate locally and through the hosted issue-event path.

**Tech Stack:** GitHub Actions YAML, `anthropics/claude-code-action` v1.0.173 pinned by SHA, Anthropic custom headers, CLIProxyAPI, Nginx, Prettier, Bash, GitHub CLI.

## Global Constraints

- Keep `actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3` unchanged.
- Keep `anthropics/claude-code-action@f1bd27ca5b54584506e40e17884d90bdaaa1a9b3 # v1.0.173` unchanged.
- Keep the existing `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL_NAME` Secret names and values.
- Add no Secret references or write permissions to `authorize`.
- Keep `show_full_output: false`, `--max-turns 10`, and the 20-minute Claude job timeout.
- Do not change Nginx, CLIProxyAPI `config.yaml`, OAuth tokens, caller authorization policy, or action permissions.
- Never print the external API key or OAuth material; verify GitHub log masking after the hosted run.
- The known local PostgreSQL test-database blocker is unrelated; this plan changes only YAML and Markdown.

---

### Task 1: Add Bearer Header Compatibility

**Files:**

- Modify: `.github/workflows/claude-llm.yml:85`
- Modify: `docs/superpowers/specs/2026-07-15-claude-llm-bearer-header-compatibility-design.md:4`
- Create: `docs/superpowers/plans/2026-07-15-claude-llm-bearer-header-compatibility.md`

**Interfaces:**

- Consumes: `secrets.LLM_API_KEY`, the existing `claude_run` authorization gate, and the existing `ANTHROPIC_BASE_URL` environment variable.
- Produces: `ANTHROPIC_CUSTOM_HEADERS` in `Header: value` format for the pinned Action and Anthropic SDK.

- [ ] **Step 1: Run the missing-header invariant and verify RED**

Run:

```bash
bash -euo pipefail -c '
file=.github/workflows/claude-llm.yml
rg -F -q "ANTHROPIC_CUSTOM_HEADERS: \"Authorization: Bearer \${{ secrets.LLM_API_KEY }}\"" "$file"
'
```

Expected: exit code 1 because the merged workflow has no Bearer custom header. Hosted RED evidence is Actions run `29386345951`, where `authorize` passed and the first model request failed twice with `is_error:true` and zero cost.

- [ ] **Step 2: Add the minimal custom header**

Change the Action step environment to exactly:

```yaml
env:
  ANTHROPIC_BASE_URL: ${{ secrets.LLM_BASE_URL }}
  ANTHROPIC_CUSTOM_HEADERS: "Authorization: Bearer ${{ secrets.LLM_API_KEY }}"
```

Do not change any other workflow behavior.

- [ ] **Step 3: Mark the approved design implemented**

Change the design status to:

```markdown
- **상태**: 구현 완료
```

- [ ] **Step 4: Format the changed files**

Run:

```bash
pnpm --dir apps/dashboard exec prettier --write \
  ../../.github/workflows/claude-llm.yml \
  ../../docs/superpowers/specs/2026-07-15-claude-llm-bearer-header-compatibility-design.md \
  ../../docs/superpowers/plans/2026-07-15-claude-llm-bearer-header-compatibility.md
```

Expected: Prettier completes without errors.

- [ ] **Step 5: Run GREEN security and compatibility invariants**

Run:

```bash
bash -euo pipefail -c '
file=.github/workflows/claude-llm.yml
header="ANTHROPIC_CUSTOM_HEADERS: \"Authorization: Bearer \${{ secrets.LLM_API_KEY }}\""
test "$(rg -F -c "$header" "$file")" -eq 1
test "$(rg -c "uses: [^ ]+@[0-9a-f]{40}" "$file")" -eq 2
rg -q "needs\.authorize\.outputs\.authorized == .true." "$file"
rg -q "show_full_output: false" "$file"
rg -q -- "--max-turns 10" "$file"
authorize_block="$(sed -n "/^  authorize:/,/^  claude_run:/p" "$file")"
! grep -q "secrets\." <<<"$authorize_block"
! grep -Eq "(contents|pull-requests|issues): write" <<<"$authorize_block"
! rg -n "allowed_non_write_users|show_full_output: true" "$file"
'
pnpm --dir apps/dashboard exec prettier --check \
  ../../.github/workflows/claude-llm.yml \
  ../../docs/superpowers/specs/2026-07-15-claude-llm-bearer-header-compatibility-design.md \
  ../../docs/superpowers/plans/2026-07-15-claude-llm-bearer-header-compatibility.md
git diff --check
```

Expected: all commands exit 0, Prettier reports all files formatted, and no whitespace errors appear.

- [ ] **Step 6: Commit the local implementation**

Run:

```bash
git add .github/workflows/claude-llm.yml \
  docs/superpowers/specs/2026-07-15-claude-llm-bearer-header-compatibility-design.md \
  docs/superpowers/plans/2026-07-15-claude-llm-bearer-header-compatibility.md
git commit -m "fix: send bearer header to Claude proxy"
```

Expected: one implementation commit on top of the committed design, with no unrelated files.

---

### Task 2: Publish and Prove the Hosted Workflow

**Files:**

- No repository file changes unless the hosted test exposes a new defect.

**Interfaces:**

- Consumes: the Task 1 commit, repository Actions Secrets, GitHub issue events, Nginx, and CLIProxyAPI.
- Produces: a merged PR, a successful workflow run, a Claude issue comment, and a closed temporary smoke-test issue.

- [ ] **Step 1: Push and create the fix PR**

Run:

```bash
git push -u origin fix/claude-llm-bearer-header
pr_url=$(gh pr create \
  --base main \
  --head fix/claude-llm-bearer-header \
  --title "fix: send bearer header to Claude proxy" \
  --body "Adds the Anthropic Bearer custom header required by the existing Nginx policy. Preserves the authorization gate, Secret names, pinned actions, bounded turns, and hidden full output. Hosted smoke test follows after merge.")
printf 'PR=%s\n' "$pr_url"
```

Expected: GitHub returns a new PR URL.

- [ ] **Step 2: Wait for CI and repository auto-merge**

Run:

```bash
gh pr checks --watch --fail-fast
for attempt in {1..12}; do
  state=$(gh pr view --json state --jq '.state')
  if [[ "$state" == "MERGED" ]]; then
    break
  fi
  sleep 5
done
test "$state" = "MERGED"
gh pr view --json number,state,mergeCommit,url
```

Expected: required checks pass and the PR state becomes `MERGED`. If repository auto-merge does not merge it, stop before forcing a merge.

- [ ] **Step 3: Create a safe hosted smoke-test issue**

Run:

```bash
issue_url=$(gh issue create \
  --title "test: Claude Bearer header workflow smoke test" \
  --body $'@claude 이 요청은 Bearer 헤더 수정 후 smoke test입니다.\n\n저장소 파일, 브랜치, 커밋, PR을 만들지 마세요. 정상이라면 `CLIProxyAPI smoke test OK`라는 댓글만 남겨 주세요.')
issue_number=${issue_url##*/}
printf 'ISSUE=%s\n' "$issue_url"
```

Expected: GitHub returns a temporary issue URL and `issue_number` contains its numeric identifier.

- [ ] **Step 4: Watch the issue-event workflow**

Run:

```bash
run_id=$(gh run list \
  --workflow "Claude Code Custom LLM Integration" \
  --event issues \
  --limit 1 \
  --json databaseId \
  --jq '.[0].databaseId')
test -n "$run_id"
gh run watch "$run_id" --interval 5 --exit-status
```

Expected: both `authorize` and `claude_run` complete successfully.

- [ ] **Step 5: Verify the Claude response and Secret masking**

Run:

```bash
issue_number=$(gh issue list \
  --state open \
  --search '"test: Claude Bearer header workflow smoke test" in:title' \
  --limit 1 \
  --json number \
  --jq '.[0].number')
run_id=$(gh run list \
  --workflow "Claude Code Custom LLM Integration" \
  --event issues \
  --limit 1 \
  --json databaseId \
  --jq '.[0].databaseId')
test -n "$issue_number"
test -n "$run_id"
gh issue view "$issue_number" --json comments \
  --jq '.comments[] | {author:.author.login,body}'
external_key=$(yq -r '.api-keys[1]' /home/gon/projects/cli-proxy-api/config.yaml)
! gh run view "$run_id" --log | grep -Fq -- "$external_key"
gh run view "$run_id" --log | rg \
  'ANTHROPIC_API_KEY: .*\*\*\*|ANTHROPIC_BASE_URL: .*\*\*\*|ANTHROPIC_CUSTOM_HEADERS: .*\*\*\*|show_full_output: false'
```

Expected: Claude posts `CLIProxyAPI smoke test OK`, the literal external key is absent, and sensitive environment values appear masked.

- [ ] **Step 6: Close the temporary issue**

Run:

```bash
issue_number=$(gh issue list \
  --state open \
  --search '"test: Claude Bearer header workflow smoke test" in:title' \
  --limit 1 \
  --json number \
  --jq '.[0].number')
test -n "$issue_number"
gh issue close "$issue_number" \
  --reason completed \
  --comment "Bearer header smoke test passed; closing the temporary issue."
```

Expected: the test issue is closed.
