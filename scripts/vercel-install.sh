#!/usr/bin/env bash
set -euo pipefail

curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
  | sh -s -- -y --default-toolchain stable --profile minimal --target wasm32-unknown-unknown

curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

pnpm install --no-frozen-lockfile
