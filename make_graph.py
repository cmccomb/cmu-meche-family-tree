#!/usr/bin/env python3
"""
Command‑line utility for generating an advisor/advisee family tree from a
publicly available CSV file.  The resulting graph is rendered using the
Graphviz package.  See the accompanying README for usage details.

The input CSV is expected to contain the following columns (case and
whitespace are ignored):

```
generation, advisee, advisor, title, year
```

Each row defines an advisee, their advisor(s), an optional title, and
the year the advisee received their Ph.D. or equivalent.  The
``generation`` column is used to flag current CMU Mechanical
Engineering faculty.  A value of 0/False indicates a CMU faculty
member and will be highlighted differently in the output.  A value of
1/True or a blank means the person is not a CMU MechE faculty member.

Advisors can be listed as a single name or as multiple names separated
by semicolons, commas or line breaks.  Two special advisor tokens are
recognized (case–insensitive): ``None`` and ``ILL Request``.  If
``None`` appears in the advisor column, the advisee will be drawn in
light pink to indicate that no advisor is recorded.  If ``ILL
Request`` appears, the advisee will be drawn in orange to indicate
that an interlibrary loan request may be necessary.

The script writes three files: ``<basename>.dot`` containing the DOT
source used to build the graph, ``<basename>.png`` containing a raster
render, and ``<basename>.svg`` containing a vector render.  You must
have Graphviz installed on your system to perform the rendering.  See
the Graphviz documentation for installation instructions【891944500095481†L6-L21】.

``pandas.read_csv`` accepts a URL as a file path, so a published
Google Sheet in CSV format can be loaded directly【870401253321505†L138-L145】.
"""

from __future__ import annotations

import argparse
import math
import re
from typing import Dict, Iterable, List, Optional, Set, Tuple

import pandas as pd
from graphviz import Digraph


# -----------------------------------------------------------------------------
# Configuration: node and edge styling.  These values control the appearance
# of nodes and edges in the generated diagram.  Users can modify these
# dictionaries to customise colours and fonts.  Colour values are hex codes.

NODE_STYLE = {
    "shape": "box",
    "style": "filled,rounded",
    "fontname": "Helvetica",
    "fontsize": "10",
    "color": "black",
    "fillcolor_faculty": "#c6e2ff",        # light blue for CMU MechE faculty
    "fillcolor_nonfaculty": "#f5f5f5",      # light grey for non‑faculty
    "fillcolor_explicit_none": "#ffd6d6",  # light pink when advisor is "None"
    "fillcolor_unknown_ancestor": "#c8f7c5",  # light green for unknown ancestors
    "fillcolor_ill_request": "#FFA500",    # orange when advisor contains "ILL Request"
}

EDGE_STYLE = {
    "color": "#555555",
    "arrowsize": "0.6",
    "penwidth": "1.2",
}


def norm(s: str) -> str:
    """Normalise column names by stripping whitespace and replacing spaces with
    underscores.  All characters are converted to lower case.

    Parameters
    ----------
    s : str
        Raw column name.

    Returns
    -------
    str
        Normalised column name.
    """
    return re.sub(r"\s+", "_", str(s).strip().lower())


def to_bool(x: object) -> bool:
    """Interpret a variety of representations as booleans.

    Strings such as ``"1"``, ``"true"``, ``"t"``, ``"yes"`` are treated as
    ``True``; ``"0"``, ``"false"``, ``"f"``, ``"no"``, ``"n"`` and blank
    strings are treated as ``False``.  Numbers are cast using standard
    Python truthiness.

    Parameters
    ----------
    x : object
        Input value to convert.

    Returns
    -------
    bool
        Resulting boolean.
    """
    s = str(x).strip().lower()
    if s in {"1", "true", "t", "yes", "y"}:
        return True
    if s in {"0", "false", "f", "no", "n", ""}:
        return False
    try:
        return bool(int(float(s)))
    except Exception:
        # fall back to False for unrecognized values
        return False


def to_int_or_none(x: object) -> Optional[int]:
    """Convert a value to an integer if possible, otherwise return ``None``.

    Parameters
    ----------
    x : object
        The value to convert.

    Returns
    -------
    Optional[int]
        Integer representation or ``None`` if conversion fails.
    """
    try:
        if str(x).strip() == "":
            return None
        return int(float(x))
    except Exception:
        return None


def _normalize_token(s: object) -> str:
    """Normalise token whitespace for case-insensitive comparisons."""
    if pd.isna(s):
        return ""
    return re.sub(r"\s+", " ", str(s).strip())


PLACEHOLDER_TOKENS: Set[str] = {"none", "n/a", "na", "nan", "null", "unknown", "-"}
SPECIAL_ADVISOR_TOKENS: Set[str] = {"none", "ill request"}


def clean_name(s: object) -> Optional[str]:
    """Normalise names, skipping missing and placeholder tokens.

    Advises are passed around in their cleaned form to ensure consistent
    dictionary keys.

    Parameters
    ----------
    s : object
        Input string.

    Returns
    -------
    Optional[str]
        Cleaned name or ``None`` when token is missing/placeholder.
    """
    normalized = _normalize_token(s)
    if not normalized or normalized.casefold() in PLACEHOLDER_TOKENS:
        return None
    return normalized


def split_advisors_with_flags(val: object) -> Tuple[List[str], bool, bool]:
    """Split the advisor cell into individual advisor names and detect flags.

    The advisor field may contain multiple names separated by semicolons,
    commas or newlines.  Two special tokens are recognised: ``None`` and
    ``ILL Request``.  Those tokens are case‑insensitive and are used to
    control node colouring; they are not returned in the list of advisor
    names.

    Parameters
    ----------
    val : object
        Raw cell value from the ``advisor`` column.

    Returns
    -------
    tuple
        A tuple ``(advisors, has_none_flag, has_ill_flag)`` where

        * ``advisors`` is a list of cleaned advisor names;
        * ``has_none_flag`` is ``True`` if the cell contained ``None``;
        * ``has_ill_flag`` is ``True`` if the cell contained ``ILL Request``.
    """
    if val is None or pd.isna(val):
        return [], False, False
    raw = _normalize_token(val)
    if raw == "":
        return [], False, False

    # split by semicolons, commas or newline characters
    parts = [_normalize_token(a) for a in re.split(r"[;,\n]+", raw) if _normalize_token(a) != ""]
    parts_l = [p.casefold() for p in parts]
    has_none = any(p == "none" for p in parts_l)
    has_ill = any(p == "ill request" for p in parts_l)

    tokens_exclude = PLACEHOLDER_TOKENS | SPECIAL_ADVISOR_TOKENS
    advisors: List[str] = [p for p in parts if p.casefold() not in tokens_exclude]
    return advisors, has_none, has_ill


def build_graph(
    df: pd.DataFrame,
) -> Tuple[
    Dict[str, Dict[str, Optional[object]]], List[Tuple[str, str]], Set[str], Set[str], int
]:
    """Construct dictionaries describing people and advisor/advisee relationships.

    Parameters
    ----------
    df : pandas.DataFrame
        Normalised input data.  Column names must include
        ``generation``, ``advisee``, ``advisor``, ``title`` and ``year``.

    Returns
    -------
    tuple
        A tuple ``(people, edges, explicit_none, explicit_ill_request, skipped_rows)`` where

        * ``people`` maps a person's name to a dict with keys ``year``,
          ``cmu`` and ``title``;
        * ``edges`` is a list of ``(advisor, advisee)`` pairs;
        * ``explicit_none`` is a set of advisees whose advisor column contained
          ``None``;
        * ``explicit_ill_request`` is a set of advisees whose advisor column
          contained ``ILL Request``.
        * ``skipped_rows`` is the number of rows skipped due to missing/placeholder
          advisee values.
    """
    people: Dict[str, Dict[str, Optional[object]]] = {}
    edges: List[Tuple[str, str]] = []
    explicit_none: Set[str] = set()
    explicit_ill_request: Set[str] = set()
    skipped_rows = 0

    # First pass: build people dictionary and detect special flags
    for _, r in df.iterrows():
        advisors, has_none_flag, has_ill_flag = split_advisors_with_flags(r.get("advisor", ""))
        advisee = clean_name(r["advisee"])

        year: Optional[int] = r.get("year", None)
        # generation is stored as bool; CMU faculty are those with generation == False
        cmu: bool = bool(r.get("generation", False) == 0)
        title: Optional[str] = None if pd.isna(r.get("title", None)) else str(r.get("title", None))

        # skip rows with missing advisee names
        if advisee is None:
            skipped_rows += 1
            continue

        # record the advisee in the people dict
        if advisee not in people:
            people[advisee] = {"year": year, "cmu": cmu, "title": title}
        else:
            # merge year information if new row has a valid year
            if people[advisee]["year"] is None and year is not None:
                people[advisee]["year"] = year
            # OR the CMU flag across rows
            people[advisee]["cmu"] = people[advisee]["cmu"] or cmu
            # update title if not already present
            if not people[advisee]["title"] and title:
                people[advisee]["title"] = title

        # ensure advisor names are also present in the people dict
        for adv in advisors:
            if adv not in people:
                people[adv] = {"year": None, "cmu": False, "title": None}
            edges.append((adv, advisee))

        if has_none_flag:
            explicit_none.add(advisee)
        if has_ill_flag:
            explicit_ill_request.add(advisee)

    # Final defensive filter: remove any placeholder-like nodes that may have
    # slipped through parser edge cases.
    placeholder_nodes = {
        name for name in people if clean_name(name) is None
    }
    if placeholder_nodes:
        for node in placeholder_nodes:
            people.pop(node, None)
        explicit_none -= placeholder_nodes
        explicit_ill_request -= placeholder_nodes
        edges = [
            (advisor, student)
            for advisor, student in edges
            if advisor not in placeholder_nodes and student not in placeholder_nodes
        ]

    # De‑duplicate edges: multiple rows may specify the same advisor/advisee
    edges = list(dict.fromkeys(edges))
    return people, edges, explicit_none, explicit_ill_request, skipped_rows


def impute_years(people: Dict[str, Dict[str, Optional[object]]], placeholder: int = -1) -> None:
    """Replace missing years with a placeholder value.

    This function updates the input ``people`` dictionary in place.  Missing
    years (``None`` or NaN) are replaced with the integer ``placeholder``.

    Parameters
    ----------
    people : dict
        Mapping from person name to attribute dict.
    placeholder : int, optional
        Value to use when a year is missing.  Defaults to ``-1``.
    """
    for attrs in people.values():
        y = attrs.get("year", None)
        if y is None or (isinstance(y, float) and math.isnan(y)):
            attrs["year"] = placeholder


def find_roots(people: Dict[str, Dict[str, Optional[object]]], edges: Iterable[Tuple[str, str]],
               explicit_none: Set[str], explicit_ill: Set[str]) -> Set[str]:
    """Identify nodes with no incoming edges and not marked by special flags.

    These nodes are considered structural roots.  Nodes that appear in
    ``explicit_none`` or ``explicit_ill`` are excluded from the root set.

    Parameters
    ----------
    people : dict
        Mapping of all person names.
    edges : iterable of (str, str)
        Advisor → advisee relationships.
    explicit_none : set of str
        Names of advisees whose advisor field contained ``None``.
    explicit_ill : set of str
        Names of advisees whose advisor field contained ``ILL Request``.

    Returns
    -------
    set of str
        Names of nodes with no incoming edges and not in ``explicit_none`` or
        ``explicit_ill``.
    """
    nodes_with_incoming: Set[str] = {v for (_, v) in edges}
    all_nodes: Set[str] = set(people.keys())
    roots: Set[str] = all_nodes - nodes_with_incoming
    return roots - explicit_none - explicit_ill


def render_graph(people: Dict[str, Dict[str, Optional[object]]], edges: Iterable[Tuple[str, str]],
                 explicit_none: Set[str], explicit_ill: Set[str],
                 output_basename: str) -> None:
    """Render the advisor/advisee graph to PNG, SVG and DOT files.

    Parameters
    ----------
    people : dict
        Mapping from person names to attribute dicts.
    edges : iterable
        Collection of (advisor, advisee) pairs.
    explicit_none : set
        Names of nodes whose advisor column was explicitly ``None``.
    explicit_ill : set
        Names of nodes whose advisor column contained ``ILL Request``.
    output_basename : str
        Base filename for output files.  ``<basename>.dot`` and
        ``<basename>.png`` and ``<basename>.svg`` will be written.
    """
    roots_no_incoming = find_roots(people, edges, explicit_none, explicit_ill)

    # Build the Digraph
    dot = Digraph(
        "family_tree_dot",
        format="svg",
        graph_attr={
            "rankdir": "TB",
            "splines": "spline",
            "overlap": "false",
            "concentrate": "false",
            # tune layout performance for large graphs
            "search_size": "100000",
            "nslimit": "100000",
            "nslimit1": "100000",
            "mclimit": "1000.0",
        },
        node_attr={
            "shape": NODE_STYLE["shape"],
            "style": NODE_STYLE["style"],
            "fontname": NODE_STYLE["fontname"],
            "fontsize": NODE_STYLE["fontsize"],
            "color": NODE_STYLE["color"],
        },
        edge_attr={
            "color": EDGE_STYLE["color"],
            "arrowsize": EDGE_STYLE["arrowsize"],
            "penwidth": EDGE_STYLE["penwidth"],
        },
    )

    # Define node colours based on flags
    for name, attrs in people.items():
        if name in explicit_none:
            fill = NODE_STYLE["fillcolor_explicit_none"]
        elif name in explicit_ill:
            fill = NODE_STYLE["fillcolor_ill_request"]
        elif name in roots_no_incoming:
            fill = NODE_STYLE["fillcolor_unknown_ancestor"]
        else:
            fill = NODE_STYLE["fillcolor_faculty"] if attrs.get("cmu", False) else NODE_STYLE["fillcolor_nonfaculty"]

        y = attrs.get("year", None)
        if y is None or (isinstance(y, int) and y < 0):
            year_text = "unknown"
        else:
            year_text = str(int(y))
        label = f"{name}\n({year_text})"
        dot.node(name, label=label, fillcolor=fill)

    # Place CMU faculty at the sink (bottom) rank
    faculty = {n for n, a in people.items() if a.get("cmu", False)}
    if faculty:
        with dot.subgraph(name="rank_sink_faculty") as sub:
            sub.attr(rank="sink")
            for n in sorted(faculty):
                sub.node(n)

    # Add edges
    for u, v in edges:
        if u in people and v in people:
            dot.edge(u, v)

    # Write files
    dot_source_path = f"{output_basename}.dot"
    png_path = f"{output_basename}.png"
    svg_path = f"{output_basename}.svg"
    with open(dot_source_path, "w", encoding="utf-8") as f:
        f.write(dot.source)
    # Graphviz's pipe() method returns binary output of the requested format.
    png_bytes = dot.pipe(format="png")
    svg_bytes = dot.pipe(format="svg")
    with open(png_path, "wb") as f:
        f.write(png_bytes)
    with open(svg_path, "wb") as f:
        f.write(svg_bytes)

    print(f"Saved: {png_path}, {svg_path}, and {dot_source_path}")


def main(argv: Optional[List[str]] = None) -> None:
    parser = argparse.ArgumentParser(
        description="Generate an advisor/advisee family tree from a CSV file.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--csv",
        dest="csv_path",
        required=True,
        help=(
            "Path or URL to a CSV file containing columns generation, advisee,"
            " advisor, title and year.  URLs are supported via pandas.read_csv"
        ),
    )
    parser.add_argument(
        "--output-basename",
        dest="output_basename",
        default="family_tree",
        help="Base name for output files (without extension)",
    )
    args = parser.parse_args(argv)

    # Load data.  pandas.read_csv can accept local file paths and URLs【870401253321505†L138-L145】.
    df = pd.read_csv(args.csv_path)
    # Normalise column names
    df.columns = [norm(c) for c in df.columns]

    required_cols = {"generation", "advisee", "advisor", "title", "year"}
    missing = required_cols - set(df.columns)
    if missing:
        raise ValueError(
            f"Missing required columns: {missing}. Found columns: {list(df.columns)}"
        )

    # Convert data types
    df["generation"] = df["generation"].map(to_bool)
    df["year"] = df["year"].map(to_int_or_none)

    # Build graph data structures
    people, edges, explicit_none, explicit_ill, skipped_rows = build_graph(df)
    if skipped_rows:
        print(f"Skipped {skipped_rows} rows because advisee values were missing/placeholder.")
    # Fill missing years
    impute_years(people, placeholder=-1)
    # Render graph
    render_graph(people, edges, explicit_none, explicit_ill, args.output_basename)


if __name__ == "__main__":  # pragma: no cover
    main()
