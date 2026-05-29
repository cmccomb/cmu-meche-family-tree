#!/usr/bin/env python3
"""
Generate an advisor/advisee family tree from a CSV file.

This is intentionally kept very close to the original Colab notebook so the
Graphviz output looks the same. The main changes are:

1. Read data from a public CSV URL or local CSV file instead of gspread/Colab.
2. Expose the input/output paths as command-line arguments.
3. Save PNG and DOT files without trying to display them in a notebook.

Expected CSV columns, after lowercasing and whitespace normalization:

generation, advisee, advisor, title, year

Important data convention from the original notebook:
- generation == 0 / false is highlighted as CMU MechE faculty.
- generation == 1 / true is treated as non-faculty.
- blank or unrecognized generation values follow the original notebook behavior
  and evaluate as false, which means they may be highlighted as CMU faculty.
  For best results, use explicit 0/1 values in every row.
"""

from __future__ import annotations

import argparse
import math
import re

import pandas as pd
from graphviz import Digraph


# --- Config: kept intentionally close to the original notebook ---
INCLUDE_ONLY_CONNECTED_TO_CMU = False  # reserved for future use; original notebook left this unused
DEFAULT_OUTPUT_BASENAME = "cmu_meche_family_tree"

NODE_STYLE = {
    "shape": "box",
    "style": "filled,rounded",
    "fontname": "Helvetica",
    "fontsize": "10",
    "color": "black",
    "fillcolor_faculty": "#c6e2ff",          # light blue for CMU MechE faculty
    "fillcolor_nonfaculty": "#f5f5f5",
    "fillcolor_explicit_none": "#ffd6d6",   # light pink when advisor cell explicitly "None"
    "fillcolor_unknown_ancestor": "#c8f7c5",# light green when no known ancestor and not explicit None
    "fillcolor_ill_request": "#FFA500",     # ORANGE when advisor cell contains "ILL Request"
}
EDGE_STYLE = {
    "color": "#555555",
    "arrowsize": "0.6",
    "penwidth": "1.2",
}
TIMELINE_STYLE = {
    "fontname": "Helvetica",
    "fontsize": "10",
    "color": "#333333",
}


def norm(s):
    return re.sub(r"\s+", "_", str(s).strip().lower())


# Map generation to boolean, matching the original notebook.
# Important: downstream code treats generation == 0/False as CMU faculty.
def to_bool(x):
    s = str(x).strip().lower()
    if s in {"1", "true", "t", "yes", "y"}:
        return True
    if s in {"0", "false", "f", "no", "n", ""}:
        return False
    try:
        return bool(int(float(s)))
    except Exception:
        return False


# Coerce year to int or None, matching the original notebook.
def to_int_or_none(x):
    try:
        if str(x).strip() == "":
            return None
        return int(float(x))
    except Exception:
        return None


def clean_name(s):
    return re.sub(r"\s+", " ", str(s).strip())


PLACEHOLDER_TOKENS = {"n/a", "na", "null", "unknown", "-"}


def split_advisors_with_flags(val):
    """
    Split advisor cell into tokens; return (advisors_list, has_explicit_none, has_ill_request).
    'None' and 'ILL Request' (case-insensitive) are treated as special flags and NOT returned as advisors.
    Blank cells => advisors_list=[], flags False.
    """
    if val is None:
        return [], False, False
    raw = str(val).strip()
    if raw == "":
        return [], False, False

    parts = [clean_name(a) for a in re.split(r"[;,\n]+", raw) if a is not None and a.strip() != ""]
    parts_l = [p.lower() for p in parts]
    has_none = any(p == "none" for p in parts_l)
    has_ill = any(p == "ill request" for p in parts_l)

    tokens_exclude = PLACEHOLDER_TOKENS | {"none", "ill request"}
    advisors = [p for p in parts if p.lower() not in tokens_exclude]
    return advisors, has_none, has_ill


def load_csv(csv_path):
    # keep_default_na=False is the key CSV-only adjustment:
    # it preserves literal advisor values like "None", "n/a", and blanks instead
    # of converting them into NaN before the original notebook logic can see them.
    df = pd.read_csv(csv_path, dtype=str, keep_default_na=False)

    # ---------- NORMALIZE COLUMNS ----------
    df.columns = [norm(c) for c in df.columns]

    required = {"generation", "advisee", "advisor", "title", "year"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Missing required columns: {missing}. Found columns: {list(df.columns)}")

    df["generation"] = df["generation"].map(to_bool)
    df["year"] = df["year"].map(to_int_or_none)
    return df


def build_graph_data(df):
    # ---------- BUILD GRAPH DATA ----------
    people = {}                  # name -> {"year": int|None, "cmu": bool, "title": str|None}
    edges = []                   # (advisor, advisee)
    explicit_none = set()        # advisees where the advisor cell is exactly "None" (case-insensitive)
    explicit_ill_request = set() # advisees where advisor cell contains "ILL Request" (case-insensitive)

    # First pass: collect people, edges, special flags
    for _, r in df.iterrows():
        advisee = clean_name(r["advisee"])
        advisors, has_none_flag, has_ill_flag = split_advisors_with_flags(r.get("advisor", ""))

        year = r.get("year", None)
        cmu = bool(r.get("generation", False) == 0)  # kept exactly as in the original notebook
        title = None if pd.isna(r.get("title", None)) else str(r.get("title", None))

        if advisee not in people:
            people[advisee] = {"year": year, "cmu": cmu, "title": title}
        else:
            if people[advisee]["year"] is None and year is not None:
                people[advisee]["year"] = year
            people[advisee]["cmu"] = people[advisee]["cmu"] or cmu
            if not people[advisee]["title"] and title:
                people[advisee]["title"] = title

        for adv in advisors:
            if adv not in people:
                people[adv] = {"year": None, "cmu": False, "title": None}
            edges.append((adv, advisee))

        if has_none_flag:
            explicit_none.add(advisee)
        if has_ill_flag:
            explicit_ill_request.add(advisee)

    # ---------- REBUILD EDGES CLEANLY (skip placeholders again) ----------
    # This duplicate pass is intentionally retained from the notebook so the
    # resulting edge order and de-duplication behavior stay as close as possible.
    edges = []
    for _, r in df.iterrows():
        advisee = clean_name(r["advisee"])
        advs, _, _ = split_advisors_with_flags(r.get("advisor", ""))
        for adv in advs:
            edges.append((adv, advisee))
    edges = list(dict.fromkeys(edges))  # de-duplicate, preserving insertion order

    # ---------- IMPUTE/FLAG YEARS FOR LABELING ----------
    IMPUTED_YEAR = -1
    for _, attrs in people.items():
        y = attrs.get("year", None)
        if y is None or (isinstance(y, float) and math.isnan(y)):
            attrs["year"] = IMPUTED_YEAR

    # ---------- IDENTIFY NODES WITH NO KNOWN ANCESTOR (no incoming edges) ----------
    nodes_with_incoming = {v for (_, v) in edges}
    all_nodes = set(people.keys())
    roots_no_incoming = all_nodes - nodes_with_incoming             # structural roots
    roots_no_incoming = roots_no_incoming - explicit_none           # exclude explicit "None" cases (pink)
    roots_no_incoming = roots_no_incoming - explicit_ill_request    # exclude ILL Request cases (orange)

    return people, edges, explicit_none, explicit_ill_request, roots_no_incoming


def render_graph(people, edges, explicit_none, explicit_ill_request, roots_no_incoming, output_basename):
    # ---------- LAYOUT & RENDER (DOT, TB tree) ----------
    dot = Digraph(
        "family_tree_dot",
        format="png",
        graph_attr={
            "rankdir": "TB",
            "splines": "spline",
            "overlap": "false",
            "concentrate": "false",
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

    # Nodes: explicit 'None' => light pink; 'ILL Request' => orange; no known ancestor => green; CMU (blue); otherwise gray.
    for n, attrs in people.items():
        if n in explicit_none:
            fill = NODE_STYLE["fillcolor_explicit_none"]
        elif n in explicit_ill_request:
            fill = NODE_STYLE["fillcolor_ill_request"]
        elif n in roots_no_incoming:
            fill = NODE_STYLE["fillcolor_unknown_ancestor"]
        else:
            fill = NODE_STYLE["fillcolor_faculty"] if attrs.get("cmu", False) else NODE_STYLE["fillcolor_nonfaculty"]

        y = attrs.get("year", None)
        ytxt = "unknown" if (y is None or (isinstance(y, (int, float)) and int(y) < 0)) else str(int(y))
        label = f"{n}\n({ytxt})"
        dot.node(n, label=label, fillcolor=fill)

    # ---------- separate source rank (top) for all 'ILL Request' nodes ----------
    # ill_nodes = set(explicit_ill_request)
    # if ill_nodes:
    #     with dot.subgraph(name="cluster_ill_request") as s:
    #         s.attr(label="ILL Request", style="dashed", color="#FFA500", fontname=NODE_STYLE["fontname"])
    #         s.attr(rank="source")  # top row in TB layout
    #         for n in sorted(ill_nodes):
    #             s.node(n)

    # ---------- single sink rank for all current faculty ----------
    faculty = {n for n, a in people.items() if a.get("cmu", False)}
    if faculty:
        with dot.subgraph(name="rank_sink_faculty") as s:
            s.attr(rank="sink")
            for n in sorted(faculty):
                s.node(n)

    # Edges (advisor -> advisee)
    for u, v in edges:
        if u in people and v in people:
            dot.edge(u, v)

    # Render & save. Order matches the notebook: render PNG, then save PNG and DOT.
    png_bytes = dot.pipe(format="png")
    with open(output_basename + ".png", "wb") as f:
        f.write(png_bytes)
    with open(output_basename + ".dot", "w", encoding="utf-8") as f:
        f.write(dot.source)

    print(
        f"Saved: {output_basename}.png and {output_basename}.dot "
        f"(no-known-ancestor nodes in green; explicit 'None' in pink; 'ILL Request' in orange; "
        f"CMU faculty forced to sink rank; ILL Request grouped at top)."
    )


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Generate an advisor/advisee family tree from a public CSV or local CSV file.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--csv",
        dest="csv_path",
        required=True,
        help="Path or URL to the published CSV file.",
    )
    parser.add_argument(
        "--output-basename",
        dest="output_basename",
        default=DEFAULT_OUTPUT_BASENAME,
        help="Base name for output files, without extension.",
    )
    args = parser.parse_args(argv)

    df = load_csv(args.csv_path)
    people, edges, explicit_none, explicit_ill_request, roots_no_incoming = build_graph_data(df)
    render_graph(
        people=people,
        edges=edges,
        explicit_none=explicit_none,
        explicit_ill_request=explicit_ill_request,
        roots_no_incoming=roots_no_incoming,
        output_basename=args.output_basename,
    )


if __name__ == "__main__":
    main()
