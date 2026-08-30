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
fake_asset="$temp_dir/GitHubDesktopPlus-win-x64.msi"
mkdir -p -- "$mock_bin" "$install_dir" "$mock_home"

cat > "$mock_bin/powershell.exe" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
cat >/dev/null
case "$*" in
  *OSArchitecture*)
    printf 'X64\r\n'
    ;;
  *GetTempPath*)
    printf '%s\r\n' "$GDP_TEST_WINDOWS_TEMP"
    ;;
  *)
    args=("$@")
    installer="${args[$((${#args[@]} - 2))]}"
    install_dir="${args[$((${#args[@]} - 1))]}"
    "$installer" "$install_dir"
    ;;
esac
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
printf '%s\n' "${@: -1}"
EOF

cat > "$fake_asset" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
install_dir="${1:-}"
[[ -n "$install_dir" ]]
mkdir -p -- "$install_dir"
mkdir -p -- "$install_dir/current"
cat > "$install_dir/current/gdp.exe" <<'GDP'
#!/usr/bin/env bash
printf 'gdp 0.2.1\r\n'
GDP
chmod 755 "$install_dir/current/gdp.exe"
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
    GDP_TEST_WINDOWS_TEMP="$temp_dir" \
    bash
)"

[[ -x "$install_dir/current/gdp.exe" ]]
[[ -x "$mock_home/.local/bin/gdp" ]]
[[ "$output" == *'Installed gdp 0.2.1'* ]]
[[ "$("$mock_home/.local/bin/gdp" --version | tr -d '\r')" == 'gdp 0.2.1' ]]

printf 'Piped installer smoke test passed\n'
