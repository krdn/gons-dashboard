# Balanced Claude Statusline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the active two-line Claude Code statusline while changing context colors to green below 70%, yellow from 70–89%, and red from 90%.

**Architecture:** Keep `~/.claude/settings.json` and every existing statusline segment unchanged. Make a two-condition threshold edit in the active Bash renderer, then validate syntax, boundary colors, line count, and representative stable fields with mock Claude Code JSON.

**Tech Stack:** Bash, jq, ANSI terminal color sequences, Claude Code statusline JSON

## Global Constraints

- Retain the existing two-line output and all current operational fields.
- Below 70% context usage is green.
- Context usage from 70% through 89% is yellow.
- Context usage at or above 90% is red and includes the warning marker.
- Modify only `/home/gon/.claude/hooks/statusline.sh`; do not change legacy helpers or `/home/gon/.claude/settings.json`.

---

### Task 1: Update and verify context warning thresholds

**Files:**
- Modify: `/home/gon/.claude/hooks/statusline.sh:75`
- Reference: `docs/superpowers/specs/2026-07-10-balanced-claude-statusline-design.md`
- Test: inline Bash assertions using mock statusline JSON

**Interfaces:**
- Consumes: Claude Code statusline JSON on standard input, including `.context_window.remaining_percentage`.
- Produces: the existing two-line statusline with ANSI green (`32`), yellow (`33`), or red (`31`) applied to the context segment.

- [ ] **Step 1: Run the 69% boundary assertion and confirm the current behavior fails**

```bash
output=$(printf '%s\n' '{"model":{"display_name":"Test"},"workspace":{"current_dir":"/tmp"},"session_id":"test","context_window":{"remaining_percentage":31},"cost":{"total_cost_usd":0,"total_duration_ms":0}}' | /home/gon/.claude/hooks/statusline.sh)
printf '%s' "$output" | grep -q $'\033[32m'
```

Expected before the change: exit code `1`, because the current script colors 69% yellow.

- [ ] **Step 2: Change only the context threshold comment and conditions**

Use `apply_patch` to replace this block:

```bash
    # 60% 미만 초록, 60~79% 노랑, 80% 이상 빨강(+⚠)
    if [ "$used" -ge 80 ]; then
        ctx="${C_RED}⚠ ${bar} ${used}%${C_RESET}"
    elif [ "$used" -ge 60 ]; then
```

with:

```bash
    # 70% 미만 초록, 70~89% 노랑, 90% 이상 빨강(+⚠)
    if [ "$used" -ge 90 ]; then
        ctx="${C_RED}⚠ ${bar} ${used}%${C_RESET}"
    elif [ "$used" -ge 70 ]; then
```

- [ ] **Step 3: Validate Bash syntax**

```bash
bash -n /home/gon/.claude/hooks/statusline.sh
```

Expected: exit code `0` with no output.

- [ ] **Step 4: Verify all four color boundaries**

```bash
for case in '31 32' '30 33' '11 33' '10 31'; do
  set -- $case
  remaining=$1
  color=$2
  output=$(printf '%s\n' "{\"model\":{\"display_name\":\"Test\"},\"workspace\":{\"current_dir\":\"/tmp\"},\"session_id\":\"test\",\"context_window\":{\"remaining_percentage\":$remaining},\"cost\":{\"total_cost_usd\":0,\"total_duration_ms\":0}}" | /home/gon/.claude/hooks/statusline.sh)
  printf '%s' "$output" | grep -q "$(printf '\033[%sm' "$color")" || exit 1
done
```

Expected: exit code `0`. The inputs represent 69% green, 70% yellow, 89% yellow, and 90% red.

- [ ] **Step 5: Verify two-line structure and stable fields**

```bash
output=$(printf '%s\n' '{"model":{"display_name":"TestModel"},"workspace":{"current_dir":"/tmp/example-project"},"session_id":"test-session","context_window":{"remaining_percentage":30},"cost":{"total_cost_usd":1.25,"total_duration_ms":65000,"total_lines_added":12,"total_lines_removed":3}}' | /home/gon/.claude/hooks/statusline.sh)
test "$(printf '%s\n' "$output" | awk 'END { print NR }')" -eq 2
printf '%s' "$output" | grep -q 'TestModel'
printf '%s' "$output" | grep -q 'example-project'
printf '%s' "$output" | grep -q '\$1.25'
printf '%s' "$output" | grep -q 'test-session'
```

Expected: every command exits `0`.

- [ ] **Step 6: Review the final diff**

```bash
diff -u <(sed 's/-ge 90/-ge 80/; s/-ge 70/-ge 60/; s/70% 미만 초록, 70~89% 노랑, 90% 이상/60% 미만 초록, 60~79% 노랑, 80% 이상/' /home/gon/.claude/hooks/statusline.sh) /home/gon/.claude/hooks/statusline.sh
```

Expected: the effective differences are limited to the explanatory comment and the two numeric thresholds.

- [ ] **Step 7: Report completion**

Do not commit `/home/gon/.claude/hooks/statusline.sh` because it is a user-level Claude configuration outside the repository. Report the syntax and boundary-test results and note that Claude Code will render the updated statusline after its next refresh event.
