#!/usr/bin/env bash
# Integration tests for atoms-multi SpacetimeDB module.
# Requires: spacetime CLI, module published as atoms-multi on local server.
set -euo pipefail

DB="atoms-multi"
PASS=0
FAIL=0
TOTAL=0

# Helper: run SQL, return only data rows (skip header + separator)
sql() { spacetime sql "$DB" "$1" 2>/dev/null | tail -n +3; }
call() { spacetime call "$DB" "$@" 2>/dev/null; }

# Count data rows (lines with | that aren't the separator --+--)
count_rows() {
  local result
  result=$(sql "$1" | grep -v '^$' | grep -v '^\-' | grep -c '|' 2>/dev/null) || result=0
  echo "$result"
}

# Get single value from a single-column, single-row query
get_val() { sql "$1" | grep -v '^$' | grep -v '^\-' | head -1 | tr -d ' "'; }

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  TOTAL=$((TOTAL + 1))
  if [ "$expected" = "$actual" ]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (expected=$expected, actual=$actual)"
    FAIL=$((FAIL + 1))
  fi
}

assert_gt() {
  local desc="$1" threshold="$2" actual="$3"
  TOTAL=$((TOTAL + 1))
  if [ -n "$actual" ] && [ "$actual" -gt "$threshold" ] 2>/dev/null; then
    echo "  PASS: $desc ($actual > $threshold)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (expected > $threshold, actual=$actual)"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Integration Tests: atoms-multi ==="
echo ""

# ── Setup: clean state ──────────────────────────────────────
call clear_arena
echo "[1] Arena state"
TICK=$(get_val "SELECT tick_count FROM arena_state WHERE id = 0")
assert_gt "arena_state exists and ticking" 0 "$TICK"

# ── Test: add_atom ──────────────────────────────────────────
echo "[2] add_atom"
call clear_arena
call add_atom 'pulse' '0.0' '5.0' '0.0'
N=$(count_rows "SELECT * FROM atom")
assert_eq "add_atom creates 1 atom" 1 "$N"

TYPE=$(get_val "SELECT atom_type FROM atom")
assert_eq "atom type is pulse" "pulse" "$TYPE"

# ── Test: physics runs (atom falls) ─────────────────────────
echo "[3] Physics"
call clear_arena
call add_atom 'pulse' '0.0' '5.0' '0.0'
sleep 0.5
Y=$(get_val "SELECT y FROM atom")
# y should be less than 5.0 after falling — compare as int * 100
Y_INT=$(echo "$Y" | awk '{printf "%d", $1 * 100}')
DELTA=$((500 - Y_INT))
assert_gt "atom fell (gravity active)" 0 "$DELTA"

# ── Test: spawn_machine walker ──────────────────────────────
echo "[4] spawn_machine (walker)"
call clear_arena
call spawn_machine 'walker' '0.0' '3.0' '0.0'
N=$(count_rows "SELECT * FROM atom")
assert_eq "walker spawns 9 atoms" 9 "$N"

CONNS=$(count_rows "SELECT * FROM connection")
assert_eq "walker has 8 connections" 8 "$CONNS"

# ── Test: spawn_machine oscillator ──────────────────────────
echo "[5] spawn_machine (oscillator)"
call clear_arena
call spawn_machine 'oscillator' '0.0' '3.0' '0.0'
N=$(count_rows "SELECT * FROM atom")
assert_eq "oscillator spawns 3 atoms" 3 "$N"

CONNS=$(count_rows "SELECT * FROM connection")
assert_eq "oscillator has 2 connections" 2 "$CONNS"

# ── Test: remove_atom ───────────────────────────────────────
echo "[6] remove_atom"
call clear_arena
call add_atom 'relay' '0.0' '3.0' '0.0'
ID=$(get_val "SELECT id FROM atom")
call remove_atom "$ID"
N=$(count_rows "SELECT * FROM atom")
assert_eq "remove_atom deletes atom" 0 "$N"

# ── Test: remove_atom cleans connections ────────────────────
echo "[7] remove_atom cleans connections"
call clear_arena
call spawn_machine 'oscillator' '0.0' '3.0' '0.0'
# Get any atom that has connections — use atom_type='pulse' (the center atom in oscillator)
ID=$(get_val "SELECT id FROM atom WHERE atom_type = 'pulse'")
call remove_atom "$ID"
CONNS=$(count_rows "SELECT * FROM connection")
assert_eq "connections cleaned on remove" 0 "$CONNS"

# ── Test: toggle_freeze ─────────────────────────────────────
echo "[8] toggle_freeze"
# Ensure starting unfrozen
FROZEN=$(get_val "SELECT frozen FROM arena_state WHERE id = 0")
if [ "$FROZEN" = "true" ]; then call toggle_freeze; fi

call toggle_freeze
FROZEN=$(get_val "SELECT frozen FROM arena_state WHERE id = 0")
assert_eq "toggle_freeze sets frozen=true" "true" "$FROZEN"

call toggle_freeze
FROZEN=$(get_val "SELECT frozen FROM arena_state WHERE id = 0")
assert_eq "toggle_freeze sets frozen=false" "false" "$FROZEN"

# ── Test: clear_arena ───────────────────────────────────────
echo "[9] clear_arena"
call spawn_machine 'walker' '0.0' '3.0' '0.0'
call clear_arena
NA=$(count_rows "SELECT * FROM atom")
NC=$(count_rows "SELECT * FROM connection")
NS=$(count_rows "SELECT * FROM signal")
assert_eq "clear_arena: 0 atoms" 0 "$NA"
assert_eq "clear_arena: 0 connections" 0 "$NC"
assert_eq "clear_arena: 0 signals" 0 "$NS"

# ── Test: drag_atom ─────────────────────────────────────────
echo "[10] drag_atom"
call clear_arena
# Freeze so physics doesn't move atom between drag and read
call toggle_freeze
call add_atom 'hold' '0.0' '3.0' '0.0'
ID=$(get_val "SELECT id FROM atom")
call drag_atom "$ID" '5.0' '5.0' '5.0'
X=$(get_val "SELECT x FROM atom WHERE id = $ID")
X_INT=$(echo "$X" | awk '{printf "%d", $1 * 10}')
assert_eq "drag_atom moves x to 5" 50 "$X_INT"
call toggle_freeze  # unfreeze

# ── Test: toggle_hold ───────────────────────────────────────
echo "[11] toggle_hold"
call clear_arena
call add_atom 'hold' '0.0' '3.0' '0.0'
ID=$(get_val "SELECT id FROM atom")
BEFORE=$(get_val "SELECT hold_on FROM atom WHERE id = $ID")
call toggle_hold "$ID"
AFTER=$(get_val "SELECT hold_on FROM atom WHERE id = $ID")
assert_eq "hold starts off" "false" "$BEFORE"
assert_eq "toggle_hold flips to on" "true" "$AFTER"

# ── Test: toggle_relay_mode ─────────────────────────────────
echo "[12] toggle_relay_mode"
call clear_arena
call add_atom 'relay' '0.0' '3.0' '0.0'
ID=$(get_val "SELECT id FROM atom")
M1=$(get_val "SELECT relay_mode FROM atom WHERE id = $ID")
call toggle_relay_mode "$ID"
M2=$(get_val "SELECT relay_mode FROM atom WHERE id = $ID")
call toggle_relay_mode "$ID"
M3=$(get_val "SELECT relay_mode FROM atom WHERE id = $ID")
assert_eq "relay starts as pass" "pass" "$M1"
assert_eq "relay cycles to invert" "invert" "$M2"
assert_eq "relay cycles to block" "block" "$M3"

# ── Cleanup ─────────────────────────────────────────────────
call clear_arena

echo ""
echo "=== Results: $PASS/$TOTAL passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
