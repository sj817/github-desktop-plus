#!/usr/bin/env bash

set -Eeuo pipefail

readonly DEFAULT_REPOSITORY='sj817/github-desktop-plus'

repository="${GDP_REPOSITORY:-$DEFAULT_REPOSITORY}"
release="${GDP_VERSION:-latest}"
install_dir="${GDP_INSTALL_DIR:-}"

usage() {
  cat <<'EOF'
Install GitHub Desktop Plus from GitHub Releases into the Windows user profile.

Usage: install.sh [options]

Options:
  --release <version>    Install a release such as v0.2.1 (default: latest)
  --install-dir <path>   Override the WSL installation directory
  -h, --help             Show this help

Environment variables:
  GDP_VERSION            Same as --release
  GDP_INSTALL_DIR        Same as --install-dir
  GDP_REPOSITORY         GitHub owner/repository (for mirrors and testing)
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

while (($# > 0)); do
  case "$1" in
    --release)
      (($# >= 2)) || die '--release requires a value'
      release="$2"
      shift 2
      ;;
    --install-dir)
      (($# >= 2)) || die '--install-dir requires a value'
      install_dir="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

if [[ -z "${WSL_DISTRO_NAME:-}" && ! -e /proc/sys/fs/binfmt_misc/WSLInterop ]]; then
  die 'this installer must be run inside WSL'
fi

if [[ "$release" != latest && ! "$release" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  die "invalid release: $release (expected latest or vMAJOR.MINOR.PATCH)"
fi

require_command curl
require_command powershell.exe
require_command sha256sum
require_command wslpath

windows_arch="$({
  powershell.exe -NoLogo -NoProfile -NonInteractive -Command \
    '[Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()' </dev/null
} | tr -d '\r\n')"

case "${windows_arch,,}" in
  x64)
    asset_arch='x64'
    ;;
  *)
    die "unsupported Windows architecture: ${windows_arch:-unknown} (only x64 is published)"
    ;;
esac

asset_name="gdp-windows-${asset_arch}.exe"
if [[ "$release" == latest ]]; then
  asset_base="https://github.com/${repository}/releases/latest/download"
else
  asset_base="https://github.com/${repository}/releases/download/${release}"
fi

if [[ -z "$install_dir" ]]; then
  windows_local_app_data="$({
    powershell.exe -NoLogo -NoProfile -NonInteractive -Command \
      '[Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)' </dev/null
  } | tr -d '\r\n')"
  [[ -n "$windows_local_app_data" ]] || die 'could not resolve Windows LocalAppData'
  install_dir="$(wslpath -u "${windows_local_app_data}\\GitHubDesktopPlus\\bin")"
fi

temp_dir="$(mktemp -d)"
staging_path=''
cleanup() {
  rm -rf -- "$temp_dir"
  if [[ -n "$staging_path" ]]; then
    rm -f -- "$staging_path"
  fi
}
trap cleanup EXIT

printf 'Downloading %s (%s)...\n' "$asset_name" "$release"
curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error --retry 3 \
  --output "$temp_dir/$asset_name" "$asset_base/$asset_name"
curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error --retry 3 \
  --output "$temp_dir/$asset_name.sha256" "$asset_base/$asset_name.sha256"

read -r expected_hash _ < "$temp_dir/$asset_name.sha256"
[[ "$expected_hash" =~ ^[0-9A-Fa-f]{64}$ ]] || die 'release checksum has an invalid format'
actual_hash="$(sha256sum "$temp_dir/$asset_name" | cut -d ' ' -f 1)"
[[ "${actual_hash,,}" == "${expected_hash,,}" ]] || die 'release checksum verification failed'

mkdir -p -- "$install_dir"
destination="$install_dir/gdp.exe"
staging_path="$install_dir/.gdp.exe.$$.tmp"
cp -- "$temp_dir/$asset_name" "$staging_path"
chmod 755 "$staging_path"
if ! mv -f -- "$staging_path" "$destination"; then
  die 'could not replace gdp.exe; close a running GitHub Desktop Plus instance and retry'
fi
staging_path=''

launcher_dir="$HOME/.local/bin"
launcher="$launcher_dir/gdp"
launcher_tmp="$launcher.$$.tmp"
mkdir -p -- "$launcher_dir"
printf '#!/usr/bin/env bash\nexec %q "$@"\n' "$destination" > "$launcher_tmp"
chmod 755 "$launcher_tmp"
mv -f -- "$launcher_tmp" "$launcher"

installed_version="$({ "$destination" --version </dev/null; } 2>&1 | tr -d '\r')"
printf 'Installed %s to %s\n' "$installed_version" "$destination"
printf 'WSL launcher: %s\n' "$launcher"
if [[ ":$PATH:" != *":$launcher_dir:"* ]]; then
  printf 'Open a new WSL shell or add %s to PATH, then run: gdp\n' "$launcher_dir"
else
  printf 'Run: gdp\n'
fi
