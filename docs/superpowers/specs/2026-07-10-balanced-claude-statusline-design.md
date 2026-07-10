# Balanced Claude Statusline Design

## Goal

Keep the existing two-line Claude Code statusline and align its context warnings with the selected balanced preset. Preserve all existing operational information and avoid replacing the active script.

## Display

The first line continues to show server identity, model and reasoning mode, project name, Git branch and working-tree counts, proxy health when relevant, and the current task.

The second line continues to show a ten-segment context bar, session cost, elapsed time, code-change totals, five-hour and seven-day limits, repository name, and session identifier.

Context colors use these thresholds:

- Below 70%: green
- 70–89%: yellow
- 90% or above: red with a warning marker

## Implementation

Modify only the context-threshold conditions and their explanatory comment in `~/.claude/hooks/statusline.sh`. Keep `~/.claude/settings.json` pointing to the same script. Do not alter unused legacy statusline helpers.

## Data and failure handling

Claude Code continues to pass session JSON to the script through standard input. Missing context percentages continue to produce an empty context segment rather than failing the complete statusline. Git and optional rate-limit failures remain non-fatal.

## Verification

Run the script with mock JSON at 69%, 70%, 89%, and 90% context usage. Confirm the output retains two lines, all stable fields remain present, and the ANSI color switches at the specified boundaries. Run `bash -n` to validate shell syntax.
