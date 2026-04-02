#!/bin/bash
# Run all tests (unit + E2E) and produce a combined coverage report.
# Uses lcov format for merging: concatenate lcov files, then genhtml.
set -e

rm -rf .coverage-tmp coverage

# Build client assets with source maps (needed for browser coverage mapping)
npm run build:client

# 1. Unit tests → lcov (suppress per-file text table since it's unit-only)
npx vitest run --coverage --coverage.reporter=lcov

# 2. E2E tests → V8 coverage (server-side + browser-side)
bash scripts/test-e2e-coverage.sh .coverage-tmp/e2e-v8

# 3. Convert E2E V8 coverage to lcov (include dist/client for source-mapped browser coverage)
npx c8 report \
  --temp-directory .coverage-tmp/e2e-v8 \
  --reporter lcov \
  --reports-dir .coverage-tmp/e2e-lcov \
  --include 'src/**' \
  --include 'dist/client/**' \
  --exclude 'src/client/styles/**'

# 4. Filter E2E lcov to only src/ entries (strip bundled node_modules resolved via source maps)
python3 -c "
with open('.coverage-tmp/e2e-lcov/lcov.info') as f:
    content = f.read()
records = content.split('end_of_record\n')
filtered = [r for r in records if '\nSF:src/' in r or r.startswith('SF:src/')]
with open('.coverage-tmp/e2e-lcov/lcov.info', 'w') as f:
    f.write('end_of_record\n'.join(filtered))
    if filtered:
        f.write('end_of_record\n')
"

# 5. Merge lcov files (concatenation is a valid lcov merge)
cat coverage/lcov.info .coverage-tmp/e2e-lcov/lcov.info > .coverage-tmp/merged.lcov

# 6. Generate combined HTML report
genhtml .coverage-tmp/merged.lcov -o coverage --quiet \
  --ignore-errors category,category \
  --ignore-errors inconsistent,inconsistent \
  --ignore-errors corrupt,corrupt
cp .coverage-tmp/merged.lcov coverage/lcov.info

# 7. Print combined coverage summary
python3 -c "
import re

with open('coverage/lcov.info') as f:
    content = f.read()

dirs = {}
total_hit = total_found = 0
for rec in content.split('end_of_record'):
    m = re.search(r'SF:(.+)', rec)
    if not m: continue
    path = m.group(1)
    lf = re.search(r'LF:(\d+)', rec)
    lh = re.search(r'LH:(\d+)', rec)
    found = int(lf.group(1)) if lf else 0
    hit = int(lh.group(1)) if lh else 0
    total_found += found
    total_hit += hit
    parts = path.split('/')
    d = '/'.join(parts[:3]) if len(parts) > 3 else '/'.join(parts[:2])
    dirs.setdefault(d, [0, 0])
    dirs[d][0] += hit
    dirs[d][1] += found

print()
print('Combined coverage (unit + E2E):')
print(f'{\"Directory\":<30s} {\"Lines\":>10s} {\"Coverage\":>10s}')
print('-' * 52)
for d in sorted(dirs):
    hit, found = dirs[d]
    pct = hit / found * 100 if found else 0
    print(f'{d:<30s} {f\"{hit}/{found}\":>10s} {f\"{pct:.1f}%\":>10s}')
pct = total_hit / total_found * 100 if total_found else 0
print('-' * 52)
print(f'{\"All files\":<30s} {f\"{total_hit}/{total_found}\":>10s} {f\"{pct:.1f}%\":>10s}')
print()
print('Coverage report: coverage/index.html')
"

rm -rf .coverage-tmp
