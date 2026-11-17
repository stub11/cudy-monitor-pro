#!/bin/sh
# Fail closed: never serve ARM64 OTA to a MIPSEL router. No package or network access.
set -eu
BASE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SCRIPT="$BASE/files/update-native.sh"
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT HUP INT TERM
mkdir -p "$ROOT/bin"
cat > "$ROOT/bin/uname" <<'FAKE'
#!/bin/sh
echo mips
FAKE
chmod +x "$ROOT/bin/uname"
for mode in --check --apply --check-testing; do
  if PATH="$ROOT/bin:$PATH" sh "$SCRIPT" "$mode" >"$ROOT/out" 2>"$ROOT/err"; then
    echo "Unprotected $mode on MIPSEL" >&2; exit 1
  fi
  grep -q 'only on ARM64' "$ROOT/err" || { cat "$ROOT/err" >&2; exit 1; }
done
if PATH="$ROOT/bin:$PATH" sh "$SCRIPT" --apply-testing --confirm-testing >"$ROOT/out" 2>"$ROOT/err"; then
 echo "Test OTA unexpectedly allowed on MIPSEL" >&2; exit 1
fi
grep -q 'only on ARM64' "$ROOT/err"
# A MIPSEL --diagnose reaches the read-only check BEFORE the OTA guard.
if PATH="$ROOT/bin:$PATH" sh "$SCRIPT" --diagnose >"$ROOT/out" 2>"$ROOT/err"; then
  echo "Expected missing test binary" >&2; exit 1
fi
grep -q 'monitor binary is absent' "$ROOT/err"
sh -n "$SCRIPT"
echo 'PASS: MIPSEL OTA blocked; read-only diagnosis remains available'
