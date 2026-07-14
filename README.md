# CMU MechE Family Tree

[![Tests](https://github.com/cmccomb/cmu-meche-family-tree/actions/workflows/tests.yml/badge.svg)](https://github.com/cmccomb/cmu-meche-family-tree/actions/workflows/tests.yml)
[![Coverage](https://codecov.io/gh/cmccomb/cmu-meche-family-tree/branch/main/graph/badge.svg)](https://codecov.io/gh/cmccomb/cmu-meche-family-tree)

This repository builds the CMU Mechanical Engineering advisor-student family
tree from a CSV export and serves it as a browser-based explorer.

## What it does

- Reads a CSV with columns:
  - `generation`
  - `advisee`
  - `advisor`
  - `title`
  - `university` (optional, used for university coloring)
  - `country` (optional, used directly for country coloring)
  - `continent` (optional, used directly for continent coloring)
  - `year`
- Handles multiple advisors in one cell, separated by `;`, `,`, or newlines.
- Writes `graph-data.json` for the static JavaScript app.
- Exports an ELK layered layout with older ancestors above their descendants,
  all current CMU MechE faculty pinned to the bottom row, and
  CMU faculty advisor-advisee pairs kept adjacent on that final level.
- Renders the tree in the browser with Cytoscape.js using those coordinates.
- Supports search, selected-person profiles, lineage tracing, branch focus,
  focused-lineage relayout, path finding, mini-map navigation, university,
  country, and continent coloring, chronological scaling in either orientation,
  and shareable URLs.
- Keeps temporal layouts readable by preserving the regular tree's branch order,
  mapping years linearly to the time axis, and opening stable lanes for crowded
  adjacent years without overlapping person cards.
- Exports the current visible view as vector SVG, high-resolution PNG (up to 4x,
  bounded to 48 megapixels), vector PDF, or raw JSON.

Special advisor tokens:

- `None` marks the advisee as having no recorded advisor.
- `ILL Request` marks nodes needing manual follow-up.
- Empty/NaN/nan/placeholder values are ignored for person names.

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
npm ci

python make_graph.py \
  --csv "https://docs.google.com/spreadsheets/d/.../export?format=csv" \
  --output-json docs/graph-data.json

cp \
  site/index.html \
  site/app.js \
  site/export-helpers.js \
  site/layout-helpers.js \
  site/styles.css \
  site/zoom.html \
  docs/
python -m http.server 8000 --directory docs
```

Then open `http://localhost:8000`.

## Test and coverage

Install the development dependencies and run both the Python graph-builder tests
and the JavaScript temporal-layout/export tests:

```bash
pip install -r requirements-dev.txt
npm ci
npm test
npm run coverage
```

The `Tests` GitHub Actions workflow runs both suites on every push to `main` and
on pull requests, then publishes the combined Python and JavaScript coverage to
Codecov. The JavaScript suite includes a full checked-in graph regression that
requires the temporal layout to remain collision-free.

## GitHub Pages deployment

- Set the repo secret `CSV_URL` to your published sheet CSV URL.
- Workflow in `.github/workflows/build.yml` runs on push, manual dispatch, and
  schedule.
- It writes `docs/graph-data.json`, copies the static site assets, and deploys
  to GitHub Pages.
- The live site is served from:
  `https://cmccomb.com/cmu-meche-family-tree/`

## Requirements

- Python runtime dependencies from `requirements.txt`
- Python test dependencies from `requirements-dev.txt`
- Node dependencies from `package-lock.json` for the ELK layout engine
- Network access in the browser for the pinned Cytoscape.js, jsPDF, and svg2pdf.js
  CDN assets
