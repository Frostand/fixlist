#!/bin/sh
# Offline identity gate shared by npm and Xcode; no repair or skip mode.
expected_bytes=180586112
expected_sha256=fde4639f4dc4f2e5fdcd23bbfd075266111b5bb5edf6bdbe75fc9029a91c3f68

if [ "$#" -gt 1 ]; then
  printf '%s\n' 'error: Usage: /bin/sh scripts/verify-ios-model.sh [weight-file]' >&2
  exit 1
fi

case "$0" in
  */*) script_dir=${0%/*} ;;
  *) script_dir=. ;;
esac
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd) || {
  printf '%s\n' 'error: Cannot resolve the repository from the validator path.' >&2
  exit 1
}
weight=${1-"$repo_root/ios/App/App/HazardModel/HazardImageEncoder.mlpackage/Data/com.apple.CoreML/weights/weight.bin"}
recovery='Run npm run setup -- --ios to download and verify the source weights.'
if [ "$#" -eq 1 ]; then
  recovery="$recovery Then use Xcode's Product > Clean Build Folder and rebuild the app."
fi
fail() {
  printf 'error: %s: %s\n%s\n' "$weight" "$1" "$recovery" >&2
  exit 1
}

[ -e "$weight" ] || fail 'Model weight is missing.'
[ -f "$weight" ] || fail 'Model weight must be a regular file.'
[ -r "$weight" ] || fail 'Model weight is not readable; check file permissions.'
actual_bytes=$(/usr/bin/wc -c < "$weight") || fail 'Could not read model byte count.'
if [ "$actual_bytes" -ne "$expected_bytes" ]; then
  if [ "$actual_bytes" -le 1024 ]; then
    IFS= read -r first_line < "$weight"
    [ "$first_line" != 'version https://git-lfs.github.com/spec/v1' ] || fail 'Git LFS pointer found; native model weights have not been downloaded.'
  fi
  fail "Model size mismatch: expected $expected_bytes bytes, got $actual_bytes."
fi
actual_sha256=$(/usr/bin/shasum -a 256 < "$weight") || fail 'Could not compute model SHA-256.'
actual_sha256=${actual_sha256%% *}
[ "$actual_sha256" = "$expected_sha256" ] || fail "Model SHA-256 mismatch: expected $expected_sha256, got $actual_sha256."
