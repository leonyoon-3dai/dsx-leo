#!/usr/bin/env bash
# Apply idempotent compatibility fixes to generated Kit Python bundles.
#
# The generated langchain_protocol package currently uses the PEP 728
# ``extra_items`` TypedDict syntax, while Kit's bundled typing_extensions does
# not accept that keyword. The metadata dictionaries are only consumed as
# ordinary mappings here, so removing the unsupported declaration keyword is
# safe and preserves runtime behavior.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROTOCOL_FILE="$REPO_DIR/deps/kit-usd-agents/_build/target-deps/pip_core_prebundle/langchain_protocol/protocol.py"

if [ ! -f "$PROTOCOL_FILE" ]; then
    echo "Compatibility patch skipped; generated protocol file is not present yet."
    exit 0
fi

sed -i \
    -e 's/class MessageMetadata(TypedDict, extra_items=MetadataScalar):/class MessageMetadata(TypedDict):/' \
    -e 's/class BlockDeltaFields(TypedDict, extra_items=Any):/class BlockDeltaFields(TypedDict):/' \
    "$PROTOCOL_FILE"

if grep -q 'TypedDict, extra_items=' "$PROTOCOL_FILE"; then
    echo "Unsupported TypedDict extra_items declaration remains in $PROTOCOL_FILE" >&2
    exit 1
fi

echo "Kit Python compatibility patch verified."
