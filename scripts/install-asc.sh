#!/usr/bin/env bash
set -euo pipefail
if [[ "$RUNNER_OS" == macOS && "$RUNNER_ARCH" == ARM64 ]]; then
  ASC_BINARY=asc_5.0.0_macOS_arm64
  ASC_SHA=7e1d5dfafa053555f4db63478dbcba6f2a39b1563b2171ca3f4b6404f27afbb0
elif [[ "$RUNNER_OS" == Linux && "$RUNNER_ARCH" == X64 ]]; then
  ASC_BINARY=asc_5.0.0_linux_amd64
  ASC_SHA=76dc06fab91b0f6db73f42bb977fa1f61817b5ee5cb0958a38408f1aceeb3415
else
  echo 'Unsupported standard runner; installation stopped.'
  exit 1
fi
mkdir -p "$RUNNER_TEMP/gling-bin"
curl --fail --location --silent --show-error "https://github.com/rorkai/App-Store-Connect-CLI/releases/download/5.0.0/$ASC_BINARY" -o "$RUNNER_TEMP/gling-bin/asc"
printf '%s  %s\n' "$ASC_SHA" "$RUNNER_TEMP/gling-bin/asc" | shasum -a 256 --check
chmod 700 "$RUNNER_TEMP/gling-bin/asc"
printf '%s\n' "$RUNNER_TEMP/gling-bin" >> "$GITHUB_PATH"
