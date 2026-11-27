#!/bin/sh
set -eu

# Each runtime's hooks file passes its own name.
# Literal plugin paths, so a static reader of the hooks files can follow them.
# A runtime that reads a JSON reply sets the text around the context string.
reply_head=
reply_tail=
case "${1:-}" in
  claude)
    home_sheet="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/t3-pstack-models.md"
    reader="${CLAUDE_PLUGIN_ROOT}/skills/setup-pstack/scripts/read-sheet.sh"
    context="${CLAUDE_PLUGIN_ROOT}/hooks/session-start-context.md"
    ;;
  codex)
    home_sheet="${CODEX_HOME:-$HOME/.codex}/t3-pstack-models.md"
    reader="${CLAUDE_PLUGIN_ROOT}/skills/setup-pstack/scripts/read-sheet.sh"
    context="${CLAUDE_PLUGIN_ROOT}/hooks/session-start-context.md"
    ;;
  antigravity)
    # No released version read a sheet in an Antigravity home.
    home_sheet=
    reader="${PLUGIN_ROOT}/skills/setup-pstack/scripts/read-sheet.sh"
    context="${PLUGIN_ROOT}/hooks/session-start-context.md"
    # Antigravity injects each step's text as a system message.
    reply_head='{"injectSteps":[{"systemMessage":{"systemMessage":'
    reply_tail='}}]}'
    ;;
  devin)
    # No released version read a sheet in a Devin home.
    home_sheet=
    reader="${CLAUDE_PLUGIN_ROOT}/skills/setup-pstack/scripts/read-sheet.sh"
    context="${CLAUDE_PLUGIN_ROOT}/hooks/session-start-context.md"
    # Devin injects SessionStart context only from this JSON on stdout.
    reply_head='{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":'
    reply_tail='}}'
    ;;
  kiro)
    # Kiro names no plugin root, so the installer's hooks file passes it. No
    # released version read a sheet in a Kiro home.
    home_sheet=
    reader="$2/skills/setup-pstack/scripts/read-sheet.sh"
    context="$2/hooks/session-start-context.md"
    ;;
  *)
    echo "session-start.sh: unknown runtime '${1:-}' (expected claude, codex, antigravity, devin, or kiro)" >&2
    exit 2
    ;;
esac

# One sheet per machine. Until the installer moves an older home's sheet
# there, that home's sheet still counts.
sheet="${XDG_CONFIG_HOME:-$HOME/.config}/t3-pstack/models.md"
[ -f "$sheet" ] || sheet=$home_sheet

# A sheet that cannot be decoded counts as missing, so injection stays on.
if ! { [ -f "$sheet" ] && [ -r "$sheet" ] && normalized=$(sh "$reader" "$sheet"); }; then
  normalized=
fi
off=false
if printf '%s\n' "$normalized" | grep -qx 'session hook: off'; then
  off=true
fi

if [ -n "$reply_head" ]; then
  if $off; then
    echo '{}'
  else
    awk -v head="$reply_head" -v tail="$reply_tail" 'BEGIN { printf "%s\"", head }
      { gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); gsub(/\t/, "\\t"); gsub(/\r/, "\\r"); printf "%s\\n", $0 }
      END { print "\"" tail }' "$context"
  fi
elif ! $off; then
  cat "$context"
  # Kiro loads each skill through a link with no plugin namespace.
  if [ "$1" = kiro ]; then
    printf '\n%s%s%s\n' \
      "On Kiro, t3-pstack's skills have bare names. \`t3-pstack:<name>\` is the \`<name>\` skill, and \`/t3-pstack:<name>\` is \`/<name>\`. \`<plugin root>\` is \`" \
      "$2" \
      "\`. Kiro reaches each skill through a link, so a skill's path does not lead there. T3's tools come from the \`t3-code\` MCP server, and Kiro can defer MCP tools. Load \`delegate_task\` and each other T3 tool with the tool-loading tool before its first call."
  fi
fi
