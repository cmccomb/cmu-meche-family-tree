# CMU Mechanical Engineering Family Tree

This repository provides a small utility for visualising academic family
trees in the Mechanical Engineering department at Carnegie Mellon
University.  It is a standalone command‑line script that accepts a
CSV file – exported from a Google Sheet or another source – and
generates a graph of advisor/advisee relationships.

The original prototype was a Jupyter notebook that relied on Google
Colab for authentication and spreadsheet access.  The script in this
repository removes those dependencies: any published Google Sheet can
be exported as a CSV and loaded directly using `pandas.read_csv`.  The
Pandas documentation notes that the `filepath_or_buffer` parameter can
be a URL – valid schemes include HTTP, FTP and others【870401253321505†L138-L145】.

## Contents

- **`make_graph.py`** – command‑line tool that reads a CSV file and
  writes a Graphviz DOT file and a PNG image showing the family tree.
- **`requirements.txt`** – lists the Python packages used by the script.
- **`.gitignore`** – ignores common transient files such as `__pycache__`.

## Installation

1. Install [Graphviz](https://graphviz.org/) on your system.  The
   Python `graphviz` package is a pure‑Python interface for the
   Graphviz binaries and depends on a working Graphviz installation.
   The official documentation recommends installing via your system
   package manager or from the Graphviz web site【891944500095481†L6-L21】.

2. Create and activate a Python virtual environment (optional but
   recommended):

   ```sh
   python3 -m venv venv
   source venv/bin/activate
   ```

3. Install the required Python packages:

   ```sh
   pip install -r requirements.txt
   ```

## Preparing the data

1. Open your Google Sheet and select **File → Share → Publish to the
   web**.
2. Choose **CSV** as the format and copy the provided link.  The
   resulting URL will look like:

   ```
   https://docs.google.com/spreadsheets/d/…/export?format=csv
   ```

3. Ensure your sheet contains the following columns (case and
   whitespace are ignored):

   - `generation` – 0/False for current CMU MechE faculty, 1/True
     otherwise.
   - `advisee` – the name of the person receiving the degree.
   - `advisor` – name(s) of the advisor(s).  Multiple advisors may be
     separated by semicolons, commas or line breaks.  Special tokens
     `None` or `ILL Request` (case‑insensitive) flag missing or
     unavailable advisor information.
   - `title` – the degree title or thesis description (optional).
   - `year` – the year the degree was awarded (optional).

## Usage

Run the script with the `--csv` argument pointing to your CSV file or
published CSV URL.  The `--output-basename` argument controls the
prefix of the output files (defaults to `family_tree`).

```sh
python make_graph.py --csv "https://docs.google.com/spreadsheets/d/…/export?format=csv" \
                     --output-basename cmu_meche_family_tree
```

This command will create two files in the working directory:

- **`cmu_meche_family_tree.dot`** – the Graphviz description of the
  advisor/advisee network.
- **`cmu_meche_family_tree.png`** – a rendered PNG image of the graph.

## Interpreting the graph

Nodes are drawn as rounded boxes with the advisee’s name and year in
parentheses.  Colours convey additional information:

| Colour      | Meaning                                             |
|-------------|------------------------------------------------------|
| Light blue  | Current CMU MechE faculty (`generation` = 0/False)   |
| Light grey  | Non‑faculty (`generation` = 1/True)                  |
| Light pink  | Advisor cell contained the literal `None`            |
| Light green | No incoming edges (no recorded advisor)              |
| Orange      | Advisor cell contained `ILL Request`                 |

Edges point from advisor to advisee.  All current CMU faculty are
placed on the bottom rank of the diagram to emphasise their position
in the genealogy.

## GitHub Actions and Pages deployment

This repository includes a GitHub Actions workflow (`.github/workflows/build.yml`) that automatically fetches your published CSV, rebuilds the graph and publishes the results to GitHub Pages.  To use it:

1. **Publish your spreadsheet as a CSV** and copy the link as described above.
2. **Add a repository secret named `CSV_URL`** with the CSV link.  In your repository, go to **Settings → Secrets and variables → Actions → New repository secret** and set `CSV_URL` to your export URL.
3. **Enable GitHub Pages** to serve from the `gh-pages` branch.  Go to **Settings → Pages**, choose **Deploy from a branch**, and select the `gh-pages` branch that the workflow will create.

On every push to the `main` branch (or on the nightly schedule), the workflow will:

1. Install the Python dependencies and Graphviz.
2. Run `make_graph.py` against the CSV URL defined in the `CSV_URL` secret.
3. Generate the `.png` and `.dot` files in the `docs/` directory.
4. Write a simple `index.html` that embeds the image.
5. Deploy the `docs/` directory to the `gh-pages` branch using the `peaceiris/actions-gh-pages` action.

Once configured, your GitHub Pages site will automatically update whenever your spreadsheet changes or you push changes to this repository.  You can view the generated family tree at `https://<your-username>.github.io/<repository-name>/`.

## Customisation

The script defines two dictionaries, `NODE_STYLE` and `EDGE_STYLE`,
which you can edit to adjust colours, fonts, line widths and other
attributes.  See the [Graphviz documentation](https://graphviz.org/)
for a comprehensive list of node and edge attributes.  The
`graphviz.Digraph` class is used to construct and render the graph,
and its API allows programmatic access to the DOT source【891944500095481†L40-L79】.

## Contributing

Feel free to fork this repository and adapt it for other departments
or universities.  If you add features, please consider opening a pull
request so that others can benefit.