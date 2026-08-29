#!/usr/bin/env bash

set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
temp_dir="$(mktemp -d)"
cleanup() {
  rm -rf -- "$temp_dir"
}
trap cleanup EXIT

mock_bin="$temp_dir/bin"
install_dir="$temp_dir/install"
mock_home="$temp_dir/home"
fake_asset="$temp_dir/gdp-windows-x64.exe"
mkdir -p -- "$mock_bin" "$install_dir" "$mock_home"

cat > "$mock_bin/powershell.exe" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
printf 'X64\r\n'
EOF

cat > "$mock_bin/curl" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

output=''
while (($# > 0)); do
  case "$1" in
    --output)
      output="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

[[ -n "$output" ]]
if [[ "$output" == *.sha256 ]]; then
  sha256sum "${output%.sha256}" > "$output"
else
  cp -- "$GDP_TEST_ASSET" "$output"
fi
EOF

cat > "$mock_bin/wslpath" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

cat > "$fake_asset" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
printf 'gdp 0.2.1\r\n'
EOF

chmod 755 "$mock_bin/powershell.exe" "$mock_bin/curl" "$mock_bin/wslpath" "$fake_asset"

output="$(
  cat "$repo_root/install.sh" | env \
    PATH="$mock_bin:$PATH" \
    HOME="$mock_home" \
    WSL_DISTRO_NAME='CI' \
    GDP_VERSION='v9.8.7' \
    GDP_INSTALL_DIR="$install_dir" \
    GDP_TEST_ASSET="$fake_asset" \
    bash
)"

[[ -x "$install_dir/gdp.exe" ]]
[[ -x "$mock_home/.local/bin/gdp" ]]
[[ "$output" == *'Installed gdp 0.2.1'* ]]
[[ "$("$mock_home/.local/bin/gdp" --version | tr -d '\r')" == 'gdp 0.2.1' ]]

printf 'Piped installer smoke test passed\n'
