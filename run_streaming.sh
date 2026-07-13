#!/usr/bin/env bash
# Run Kit application with streaming enabled for local web development
#
# Usage:
#   ./run_streaming.sh
#   ./run_streaming.sh --/app/auto_load_usd=/path/to/scene.usd
#
# Environment variables:
#   USD_URL - Path to USD file to load (optional, has default)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$SCRIPT_DIR"

# Build if the runnable Kit binary is not already present. A partially created
# _build directory isn't sufficient after an interrupted first build.
if [ ! -x "_build/linux-x86_64/release/kit/kit" ]; then
    echo "Building Kit application first..."

    # 1. Initialize the kit-cae submodule
    echo "Initializing kit-cae submodule..."
    git submodule update --init --recursive

    # 2. Build kit-cae schemas
    echo "Building kit-cae schemas..."
    ./deps/kit-cae/repo.sh schema

    # 3. Build kit-cae extensions
    echo "Building kit-cae extensions..."
    ./deps/kit-cae/repo.sh build

    # 4. Precache extensions (must run after kit-cae is built)
    echo "Precaching extensions..."
    ./repo.sh build -u

    # 5. Build the DSX application
    echo "Building DSX application..."
    ./repo.sh build -r
fi

# Patch generated Python bundles after the first build and verify the result.
# This is idempotent, so it is safe on every restart.
./scripts/apply_kit_compat_fixes.sh

# DSX uses its own web UI, so the built-in chat widget window is not needed.
WIDGET_TOML="deps/kit-usd-agents/source/extensions/omni.ai.chat_usd.bundle/config/extension.toml"
if [ -f "$WIDGET_TOML" ]; then
    sed -i 's/"omni.ai.langchain.widget.core" = { version = "3.0.0" }/"omni.ai.langchain.widget.core" = { version = "3.0.0", optional = true }/' "$WIDGET_TOML"
fi

LAUNCH_ARGS=("--no-window")

if [ -n "${USD_URL:-}" ]; then
    LAUNCH_ARGS+=("--/app/auto_load_usd=${USD_URL}")
fi

# Run the streaming version with no window
./repo.sh launch dsx_streaming.kit -- \
    "${LAUNCH_ARGS[@]}" \
    "$@"
