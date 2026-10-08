#!/usr/bin/env bash
# Assert that every var(--x) reference in web/*.css resolves under every theme.
#
# This is the regression guard for the theme system: a component that
# references a token some theme does not define renders unstyled in that theme,
# silently. That class of bug is what this catches.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

TOKENS="web/tokens.css"
SHEETS=(web/styles.css web/usage-styles.css web/health-styles.css web/tokens.css)
THEMES=(cozy matcha graphite ember paper)

# Tokens set at runtime by JavaScript, or scoped to a mood/state class rather
# than a theme. Not expected in tokens.css.
ALLOWLIST="look-x|look-y|bar|mood-accent|mood-accent-2|mood-glow|mood-glow-soft|mood-badge-bg|cat-fur-start|cat-fur-end|cat-ear-inner"

fail=0

# -- Collect every referenced token ------------------------------------------
referenced=$(grep -ohE 'var\(--[a-zA-Z0-9-]+' "${SHEETS[@]}" \
  | sed 's/var(--//' | sort -u | grep -vE "^($ALLOWLIST)$")

# -- Resolve the token set for one theme -------------------------------------
# Emits every token name defined for the given theme: the statics in :root,
# the blocks whose selector list mentions that theme, and the bridge.
theme_tokens() {
  local theme="$1"
  awk -v theme="$theme" '
    # Track the selector text of the block we are entering.
    /\{[[:space:]]*$/ { sel = sel $0; inblock = 1; next }
    !inblock { sel = sel " " $0; next }
    /^\}/ {
      inblock = 0; sel = ""; next
    }
    inblock {
      # Does this block apply to the theme under test?
      applies = (sel ~ /:root/ && sel !~ /data-theme/)
      if (sel ~ ("data-theme=\"" theme "\"")) applies = 1
      if (!applies) next
      if (match($0, /^[[:space:]]*--[a-zA-Z0-9-]+[[:space:]]*:/)) {
        name = $0
        sub(/^[[:space:]]*--/, "", name)
        sub(/[[:space:]]*:.*$/, "", name)
        print name
      }
    }
  ' "$TOKENS" | sort -u
}

for theme in "${THEMES[@]}"; do
  defined=$(theme_tokens "$theme")
  missing=$(comm -23 <(echo "$referenced") <(echo "$defined"))
  if [ -n "$missing" ]; then
    echo "FAIL [$theme] references tokens it does not define:"
    echo "$missing" | sed 's/^/    --/'
    fail=1
  fi
done

# -- Parity: every theme must define the same token set ----------------------
base=$(theme_tokens cozy)
for theme in "${THEMES[@]}"; do
  [ "$theme" = "cozy" ] && continue
  diff_out=$(comm -3 <(echo "$base") <(theme_tokens "$theme"))
  if [ -n "$diff_out" ]; then
    echo "FAIL [$theme] token set differs from cozy (left: cozy only, right: $theme only):"
    echo "$diff_out" | sed 's/^/    /'
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  echo "OK  $(echo "$referenced" | wc -l | tr -d ' ') tokens referenced, all resolve under ${#THEMES[@]} themes"
fi
exit "$fail"
