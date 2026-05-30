# CMU MechE Family Tree

This repository generates the CMU Mechanical Engineering advisor–advisee family tree from a CSV export and renders it with Graphviz.

## What it does

- Reads a CSV with columns:
  - `generation`
  - `advisee`
  - `advisor`
  - `title`
  - `year`
- Handles multiple advisors in one cell (separated by `;`, `,`, or newlines).
- Produces:
  - `cmu_meche_family_tree.dot`
  - `cmu_meche_family_tree.png`
  - `cmu_meche_family_tree.svg`

Special advisor tokens:
- `None` marks the advisee as unknown parentage (pink node)
- `ILL Request` marks nodes needing manual follow-up (orange node)
- Empty/NaN/nan/placeholder values are ignored for person names.

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

python make_graph.py \
  --csv "https://docs.google.com/spreadsheets/d/.../export?format=csv" \
  --output-basename cmu_meche_family_tree
```

## GitHub Pages deployment

- Set the repo secret `CSV_URL` to your published sheet CSV URL.
- Workflow in `.github/workflows/build.yml` runs on push and on schedule.
- It writes `docs/` and deploys to `gh-pages`.
- The live site is served from GitHub Pages at:
  `https://cmccomb.com/cmu-meche-family-tree/`

## Requirements

- Python dependencies from `requirements.txt`
- Graphviz installed on the machine running the script/workflow
