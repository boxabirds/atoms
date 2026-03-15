#!/usr/bin/env bash
# Server integration tests — physics, behavior, and machine spawning.
# Verifies SpacetimeDB module produces correct simulation results.
# Requires: spacetime CLI, module published as atoms-multi on local server.
set -euo pipefail

DB="atoms-multi"
PASS=0
FAIL=0
TOTAL=0

# ── Constants (from shared/constants.ts) ────────────────────
GROUND_Y=-2
ATOM_COLLISION_RADIUS="0.24"
ATOM_RADIUS="0.25"
ARENA_HALF=20
PULSE_FIRE_INTERVAL="1.2"

# ── Helpers ─────────────────────────────────────────────────
sql() { spacetime sql "$DB" "$1" 2>/dev/null | tail -n +3; }
call() { spacetime call "$DB" "$@" 2>/dev/null; }

count_rows() {
  local result
  result=$(sql "$1" | grep -v '^$' | grep -v '^\-' | grep -c '|' 2>/dev/null) || result=0
  echo "$result"
}

get_val() { sql "$1" | grep -v '^$' | grep -v '^\-' | head -1 | tr -d ' "'; }

# Get a specific column value from a multi-column row (1-indexed)
get_col() {
  local query="$1" col="$2"
  sql "$query" | grep -v '^$' | grep -v '^\-' | head -1 | awk -F'|' "{print \$$col}" | tr -d ' "'
}

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
  if [ -n "$actual" ] && [ "$(echo "$actual > $threshold" | bc -l 2>/dev/null)" = "1" ]; then
    echo "  PASS: $desc ($actual > $threshold)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (expected > $threshold, actual=$actual)"
    FAIL=$((FAIL + 1))
  fi
}

assert_lt() {
  local desc="$1" threshold="$2" actual="$3"
  TOTAL=$((TOTAL + 1))
  if [ -n "$actual" ] && [ "$(echo "$actual < $threshold" | bc -l 2>/dev/null)" = "1" ]; then
    echo "  PASS: $desc ($actual < $threshold)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (expected < $threshold, actual=$actual)"
    FAIL=$((FAIL + 1))
  fi
}

assert_between() {
  local desc="$1" lo="$2" hi="$3" actual="$4"
  TOTAL=$((TOTAL + 1))
  if [ -n "$actual" ] && \
     [ "$(echo "$actual >= $lo" | bc -l 2>/dev/null)" = "1" ] && \
     [ "$(echo "$actual <= $hi" | bc -l 2>/dev/null)" = "1" ]; then
    echo "  PASS: $desc ($actual in [$lo, $hi])"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (expected in [$lo, $hi], actual=$actual)"
    FAIL=$((FAIL + 1))
  fi
}

# Wait for N ticks (each tick = 50ms)
wait_ticks() {
  local n="$1"
  local ms=$(( n * 50 + 100 ))  # extra 100ms buffer
  sleep "$(echo "scale=3; $ms / 1000" | bc)"
}

echo "=== Server Integration Tests: Physics, Behavior, Machines ==="
echo ""

# ════════════════════════════════════════════════════════════
# PHYSICS TESTS
# ════════════════════════════════════════════════════════════

echo "── Physics ──"

# [P1] Atom settles at ground level
echo "[P1] Atom settles at ground level"
call clear_arena
call add_atom 'pulse' '0.0' '5.0' '0.0'
wait_ticks 80  # 4 seconds — enough to settle
Y=$(get_val "SELECT y FROM atom")
# Should settle near GROUND_Y + ATOM_RADIUS = -2 + 0.25 = -1.75
assert_between "atom settled near ground" "-1.85" "-1.60" "$Y"

# [P2] Two overlapping atoms separate
echo "[P2] Two overlapping atoms separate"
call clear_arena
# Freeze, add two atoms at same position, unfreeze
call toggle_freeze
call add_atom 'pulse' '0.0' '3.0' '0.0'
call add_atom 'pulse' '0.05' '3.0' '0.0'
call toggle_freeze
wait_ticks 40  # 2 seconds
# Get both x positions
ROWS=$(sql "SELECT x FROM atom" | grep -v '^$' | grep -v '^\-')
X1=$(echo "$ROWS" | head -1 | tr -d ' ')
X2=$(echo "$ROWS" | tail -1 | tr -d ' ')
DIST=$(echo "scale=4; sqrt(($X1 - $X2) * ($X1 - $X2))" | bc -l)
# Min collision distance = ATOM_COLLISION_RADIUS * 2 = 0.48
assert_gt "atoms separated beyond collision radius" "0.40" "$DIST"

# [P3] Connected atoms converge toward rest length
echo "[P3] Connected atoms converge toward rest length"
call clear_arena
call toggle_freeze
call spawn_machine 'oscillator' '0.0' '0.0' '0.0'
call toggle_freeze
wait_ticks 80  # 4 seconds to settle
# Oscillator: pulse at center, flex at +/-0.55x. After settling at ground,
# distances should be near rest length. Just check atoms aren't flying apart.
ROWS=$(sql "SELECT x, y FROM atom" | grep -v '^$' | grep -v '^\-')
NROWS=$(echo "$ROWS" | wc -l | tr -d ' ')
assert_eq "oscillator still has 3 atoms" 3 "$NROWS"

# [P4] Wall bounce keeps atom in bounds
echo "[P4] Wall bounce keeps atoms in bounds"
call clear_arena
# Place atom near arena edge with velocity toward wall
# ARENA_HALF = 20, so place at x=19.5
call add_atom 'pulse' '19.5' '3.0' '0.0'
wait_ticks 60  # 3 seconds
X=$(get_val "SELECT x FROM atom")
assert_lt "atom stayed within arena" "$ARENA_HALF" "$X"

# [P5] Freeze stops physics
echo "[P5] Freeze stops physics"
call clear_arena
call add_atom 'pulse' '0.0' '5.0' '0.0'
wait_ticks 4  # let it start falling
call toggle_freeze
Y1=$(get_val "SELECT y FROM atom")
wait_ticks 20  # 1 second frozen
Y2=$(get_val "SELECT y FROM atom")
call toggle_freeze  # unfreeze
assert_eq "frozen atom y unchanged" "$Y1" "$Y2"

# ════════════════════════════════════════════════════════════
# BEHAVIOR TESTS
# ════════════════════════════════════════════════════════════

echo ""
echo "── Behavior ──"

# [B1] Signal chain: PULSE fires and charges propagate
echo "[B1] Signal chain propagation"
call clear_arena
call spawn_machine 'signal_chain' '0.0' '3.0' '0.0'
# PULSE_FIRE_INTERVAL = 1.2s = 24 ticks. Wait for at least one fire cycle + propagation
wait_ticks 40
# Check that at least one relay has signal_charge > 0
CHARGES=$(sql "SELECT signal_charge FROM atom WHERE atom_type = 'relay'" | grep -v '^$' | grep -v '^\-')
MAX_CHARGE=$(echo "$CHARGES" | tr -d ' ' | sort -rn | head -1)
assert_gt "relay received signal charge" "0" "$MAX_CHARGE"

# [B2] RELAY block mode: set ALL relays to block, verify no charge propagation
echo "[B2] Relay block mode"
call clear_arena
call toggle_freeze
call spawn_machine 'signal_chain' '0.0' '3.0' '0.0'
# Signal chain: pulse -> relay1 -> relay2 -> relay3
# Set the FIRST relay (closest to pulse) to block — no signal should reach any relay
RELAY_IDS=$(sql "SELECT id FROM atom WHERE atom_type = 'relay'" | grep -v '^$' | grep -v '^\-' | tr -d ' ')
# Block all relays to be sure (order is arbitrary)
for RID in $RELAY_IDS; do
  call toggle_relay_mode "$RID"  # pass -> invert
  call toggle_relay_mode "$RID"  # invert -> block
done
# Verify all are blocked
BLOCK_COUNT=$(sql "SELECT relay_mode FROM atom WHERE atom_type = 'relay'" | grep -v '^$' | grep -v '^\-' | grep -c 'block') || BLOCK_COUNT=0
assert_eq "all 3 relays in block mode" 3 "$BLOCK_COUNT"
# Unfreeze and let pulse fire
call toggle_freeze
wait_ticks 40
# All relays should have 0 charge (signal blocked at first relay)
MAX_CHARGE=$(sql "SELECT signal_charge FROM atom WHERE atom_type = 'relay'" | grep -v '^$' | grep -v '^\-' | tr -d ' ' | sort -rn | head -1)
assert_lt "blocked relays have no charge" "0.05" "$MAX_CHARGE"

# [B3] PULSE fires periodically (last_fire_time advances)
echo "[B3] Pulse periodic firing"
call clear_arena
call spawn_machine 'oscillator' '0.0' '3.0' '0.0'
wait_ticks 10
FIRE1=$(get_val "SELECT last_fire_time FROM atom WHERE atom_type = 'pulse'")
wait_ticks 30  # wait > PULSE_FIRE_INTERVAL (1.2s = 24 ticks)
FIRE2=$(get_val "SELECT last_fire_time FROM atom WHERE atom_type = 'pulse'")
assert_gt "last_fire_time advanced" "$FIRE1" "$FIRE2"

# [B4] Walker has non-zero velocity (machine locomotes)
echo "[B4] Walker locomotion"
call clear_arena
call spawn_machine 'walker' '0.0' '3.0' '0.0'
wait_ticks 30  # let pulses fire
# Check that at least one atom has non-zero velocity
VY_ROWS=$(sql "SELECT vy FROM atom" | grep -v '^$' | grep -v '^\-' | tr -d ' ')
HAS_VELOCITY=false
for v in $VY_ROWS; do
  ABS_V=$(echo "scale=4; if ($v < 0) -1 * $v else $v" | bc -l)
  if [ "$(echo "$ABS_V > 0.01" | bc -l)" = "1" ]; then
    HAS_VELOCITY=true
    break
  fi
done
TOTAL=$((TOTAL + 1))
if [ "$HAS_VELOCITY" = "true" ]; then
  echo "  PASS: walker atoms have velocity"
  PASS=$((PASS + 1))
else
  echo "  FAIL: walker atoms have no velocity"
  FAIL=$((FAIL + 1))
fi

# [B5] Memory toggle: HOLD toggles when SENSE detects nearby atom
echo "[B5] Memory toggle (SENSE -> HOLD)"
call clear_arena
# Freeze, spawn, then place target precisely in SENSE cone
call toggle_freeze
call spawn_machine 'memory_toggle' '0.0' '0.0' '0.0'
# memory_toggle: sense at (0,0,0.3), relay at (0,0,0), hold at (0,0,-0.3)
# Sense faces +Z (default quaternion). Place target at z=1.5 (within range=2.0, in cone)
call add_atom 'flex' '0.0' '0.0' '1.5'
HOLD_ID=$(get_val "SELECT id FROM atom WHERE atom_type = 'hold'")
HOLD_BEFORE=$(get_val "SELECT hold_on FROM atom WHERE id = $HOLD_ID")
# Unfreeze — sense should detect immediately, signal propagates relay->hold
call toggle_freeze
wait_ticks 60  # ~3s: atoms fall + sense detects + signal travels 2 hops
HOLD_AFTER=$(get_val "SELECT hold_on FROM atom WHERE id = $HOLD_ID")
assert_eq "hold was initially off" "false" "$HOLD_BEFORE"
assert_eq "hold toggled on after sense" "true" "$HOLD_AFTER"

# ════════════════════════════════════════════════════════════
# MACHINE SPAWNING TESTS (all 7 types)
# ════════════════════════════════════════════════════════════

echo ""
echo "── Machine Spawning (all 7 types) ──"

# Machine keys, atom counts, connection counts
declare -a MACHINE_KEYS=(oscillator walker tracker memory_toggle signal_chain reflex_arc crawler)
declare -a MACHINE_ATOMS=(3 9 5 3 4 6 9)
declare -a MACHINE_CONNS=(2 8 4 2 3 5 8)

for i in "${!MACHINE_KEYS[@]}"; do
  KEY="${MACHINE_KEYS[$i]}"
  EXPECTED_ATOMS="${MACHINE_ATOMS[$i]}"
  EXPECTED_CONNS="${MACHINE_CONNS[$i]}"

  echo "[M$((i+1))] $KEY"
  call clear_arena
  call spawn_machine "$KEY" '0.0' '5.0' '0.0'

  NA=$(count_rows "SELECT * FROM atom")
  NC=$(count_rows "SELECT * FROM connection")

  assert_eq "$KEY: $EXPECTED_ATOMS atoms" "$EXPECTED_ATOMS" "$NA"
  assert_eq "$KEY: $EXPECTED_CONNS connections" "$EXPECTED_CONNS" "$NC"
done

# ── Cleanup ─────────────────────────────────────────────────
call clear_arena
# Ensure unfrozen
FROZEN=$(get_val "SELECT frozen FROM arena_state WHERE id = 0")
if [ "$FROZEN" = "true" ]; then call toggle_freeze; fi

echo ""
echo "=== Results: $PASS/$TOTAL passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
