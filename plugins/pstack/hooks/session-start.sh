#!/bin/sh
set -eu

# Each runtime's hooks file passes its own name.
# Literal plugin paths, so a static reader of the hooks files can follow them.
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
    ;;
  kiro)
    # Kiro names no plugin root, so the installer's hooks file passes it. No
    # released version read a sheet in a Kiro home.
    home_sheet=
    reader="$2/skills/setup-pstack/scripts/read-sheet.sh"
    context="$2/hooks/session-start-context.md"
    ;;
  *)
    echo "session-start.sh: unknown runtime '${1:-}' (expected claude, codex, antigravity, or kiro)" >&2
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

# Antigravity reads a JSON reply and injects each step's text as a system message.
if [ "$1" = antigravity ]; then
  if $off; then
    echo '{}'
  else
    awk 'BEGIN { printf "{\"injectSteps\":[{\"systemMessage\":{\"systemMessage\":\"" }
      { gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); gsub(/\t/, "\\t"); gsub(/\r/, "\\r"); printf "%s\\n", $0 }
      END { print "\"}}]}" }' "$context"
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
