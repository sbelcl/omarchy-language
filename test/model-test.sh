#!/bin/bash
# Unit tests for Model.js and locales.awk. Needs node; nothing else.
set -euo pipefail
cd "$(dirname "$0")"
exec node model-test.js
