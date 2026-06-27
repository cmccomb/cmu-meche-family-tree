# CMU MechE Family Tree

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
  country, and continent coloring, chronological vertical scaling, and
  shareable URLs.

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

cp site/index.html site/app.js site/styles.css site/zoom.html docs/
python -m http.server 8000 --directory docs
```

Then open `http://localhost:8000`.

## GitHub Pages deployment

- Set the repo secret `CSV_URL` to your published sheet CSV URL.
- Workflow in `.github/workflows/build.yml` runs on push, manual dispatch, and
  schedule.
- It writes `docs/graph-data.json`, copies the static site assets, and deploys
  to GitHub Pages.
- The live site is served from:
  `https://cmccomb.com/cmu-meche-family-tree/`

## Requirements

- Python dependencies from `requirements.txt`
- Node dependencies from `package-lock.json` for the ELK layout engine
- Network access in the browser for the pinned Cytoscape.js CDN asset
