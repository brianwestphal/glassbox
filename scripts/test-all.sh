#!/bin/bash
# Run all tests (unit + E2E) and produce a combined coverage report.
set -e

rm -rf .coverage-tmp coverage

# 1. Unit tests with coverage
npx vitest run --coverage

# 2. E2E tests with V8 coverage on the server process
bash scripts/test-e2e-coverage.sh .coverage-tmp/e2e-v8

# 3. Convert E2E V8 coverage to Istanbul JSON
mkdir -p .coverage-tmp/e2e-istanbul .coverage-tmp/merge .coverage-tmp/nyc
npx c8 report \
  --temp-directory .coverage-tmp/e2e-v8 \
  --reporter json \
  --reports-dir .coverage-tmp/e2e-istanbul \
  --include 'src/**' \
  --exclude 'src/client/styles/**'

# 4. Merge unit + E2E coverage
cp coverage/coverage-final.json .coverage-tmp/merge/unit.json
cp .coverage-tmp/e2e-istanbul/coverage-final.json .coverage-tmp/merge/e2e.json
npx nyc merge .coverage-tmp/merge .coverage-tmp/nyc/coverage.json

# 5. Generate combined report
npx nyc report \
  --temp-dir .coverage-tmp/nyc \
  --reporter text \
  --reporter html \
  --reporter json \
  --report-dir coverage \
  --include 'src/**' \
  --exclude 'src/client/styles/**'

rm -rf .coverage-tmp
echo ""
echo "Combined coverage report: coverage/index.html"
