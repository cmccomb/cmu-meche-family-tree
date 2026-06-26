#!/usr/bin/env python3
"""Build structured data for the CMU MechE academic family tree site.

The input CSV is expected to contain these columns, with case and whitespace
ignored:

```
generation, advisee, advisor, title, year
```

Each row defines an advisee, their advisor(s), an optional title or degree, and
the year the advisee received that degree. Advisors can be listed as a single
name or as multiple names separated by semicolons, commas, or line breaks.

The script writes a JSON file consumed by the browser-based explorer. Graph
filtering, search, path finding, and branch focus happen in JavaScript, while
the exported data preserves a Graphviz-like advisor-sensitive tree layout.
"""

from __future__ import annotations

import argparse
from collections import defaultdict, deque
import hashlib
import json
import math
import re
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple

import pandas as pd


PLACEHOLDER_TOKENS: Set[str] = {"none", "n/a", "na", "nan", "null", "unknown", "-"}
SPECIAL_ADVISOR_TOKENS: Set[str] = {"none", "ill request"}

CATEGORY_LABELS = {
    "cmu-faculty": "CMU faculty",
    "alumni": "Alumni and students",
    "unknown-lineage": "Unknown lineage",
    "missing-advisor": "No advisor recorded",
    "follow-up": "Follow-up needed",
}


def norm(s: str) -> str:
    """Normalize column names."""
    return re.sub(r"\s+", "_", str(s).strip().lower())


def is_cmu_faculty_marker(x: object) -> bool:
    """Return whether a generation value marks a current CMU MechE faculty node.

    The source convention treats explicit 0/False-like values as faculty.
    Blank values are not faculty.
    """
    if x is None or pd.isna(x):
        return False

    if isinstance(x, bool):
        return not x

    s = str(x).strip().lower()
    if s == "":
        return False
    if s in {"0", "false", "f", "no", "n"}:
        return True
    if s in {"1", "true", "t", "yes", "y"}:
        return False

    try:
        return float(s) == 0
    except Exception:
        return False


def to_int_or_none(x: object) -> Optional[int]:
    """Convert a value to an integer if possible, otherwise return None."""
    try:
        if str(x).strip() == "":
            return None
        return int(float(x))
    except Exception:
        return None


def _normalize_token(s: object) -> str:
    """Normalize token whitespace for case-insensitive comparisons."""
    if pd.isna(s):
        return ""
    return re.sub(r"\s+", " ", str(s).strip())


def clean_name(s: object) -> Optional[str]:
    """Normalize names, skipping missing and placeholder tokens."""
    normalized = _normalize_token(s)
    if not normalized or normalized.casefold() in PLACEHOLDER_TOKENS:
        return None
    return normalized


def split_advisors_with_flags(val: object) -> Tuple[List[str], bool, bool]:
    """Split advisor cells into names and detect special source flags."""
    if val is None or pd.isna(val):
        return [], False, False

    raw = _normalize_token(val)
    if raw == "":
        return [], False, False

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
    """Construct people and advisor-to-advisee relationships from CSV rows."""
    people: Dict[str, Dict[str, Optional[object]]] = {}
    edges: List[Tuple[str, str]] = []
    explicit_none: Set[str] = set()
    explicit_ill_request: Set[str] = set()
    skipped_rows = 0

    for _, r in df.iterrows():
        advisors, has_none_flag, has_ill_flag = split_advisors_with_flags(r.get("advisor", ""))
        advisee = clean_name(r["advisee"])
        year: Optional[int] = to_int_or_none(r.get("year", None))
        cmu = is_cmu_faculty_marker(r.get("generation", None))
        title = None if pd.isna(r.get("title", None)) else str(r.get("title", None)).strip()
        if title == "":
            title = None

        if advisee is None:
            skipped_rows += 1
            continue

        if advisee not in people:
            people[advisee] = {"year": year, "cmu": cmu, "title": title}
        else:
            if people[advisee]["year"] is None and year is not None:
                people[advisee]["year"] = year
            people[advisee]["cmu"] = bool(people[advisee]["cmu"]) or cmu
            if not people[advisee]["title"] and title:
                people[advisee]["title"] = title

        for advisor in advisors:
            if advisor not in people:
                people[advisor] = {"year": None, "cmu": False, "title": None}
            edges.append((advisor, advisee))

        if has_none_flag:
            explicit_none.add(advisee)
        if has_ill_flag:
            explicit_ill_request.add(advisee)

    placeholder_nodes = {name for name in people if clean_name(name) is None}
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

    edges = list(dict.fromkeys(edges))
    return people, edges, explicit_none, explicit_ill_request, skipped_rows


def impute_years(people: Dict[str, Dict[str, Optional[object]]], placeholder: int = -1) -> None:
    """Replace missing years with a placeholder value in place."""
    for attrs in people.values():
        y = attrs.get("year", None)
        if y is None or (isinstance(y, float) and math.isnan(y)):
            attrs["year"] = placeholder


def find_roots(
    people: Dict[str, Dict[str, Optional[object]]],
    edges: Iterable[Tuple[str, str]],
    explicit_none: Set[str],
    explicit_ill: Set[str],
) -> Set[str]:
    """Identify structural roots with no incoming advisor edge."""
    nodes_with_incoming: Set[str] = {v for (_, v) in edges}
    all_nodes: Set[str] = set(people.keys())
    roots = all_nodes - nodes_with_incoming
    return roots - explicit_none - explicit_ill


def stable_person_id(name: str) -> str:
    """Create a stable, URL-friendly person id."""
    slug = re.sub(r"[^a-z0-9]+", "-", name.casefold()).strip("-") or "person"
    digest = hashlib.sha1(name.encode("utf-8")).hexdigest()[:8]
    return f"{slug}-{digest}"


def era_for_year(year: Optional[object]) -> str:
    """Group years into coarse eras for filtering."""
    if not isinstance(year, int) or year < 0:
        return "Unknown year"
    if year < 1980:
        return "Before 1980"
    if year < 2000:
        return "1980-1999"
    if year < 2010:
        return "2000-2009"
    if year < 2020:
        return "2010-2019"
    return "2020-present"


def role_for_person(attrs: Dict[str, Optional[object]]) -> str:
    """Return a compact role filter label."""
    if attrs.get("cmu", False):
        return "CMU faculty"

    title = str(attrs.get("title") or "").casefold()
    normalized = re.sub(r"[^a-z0-9]+", "", title)
    if "phd" in normalized or "doctor" in normalized:
        return "PhD alumni"
    if "ms" in normalized or "msc" in normalized or "master" in normalized:
        return "MS alumni"
    if title.strip():
        return str(attrs.get("title"))
    return "Unlisted role"


def category_for_person(
    name: str,
    attrs: Dict[str, Optional[object]],
    roots: Set[str],
    explicit_none: Set[str],
    explicit_ill: Set[str],
) -> str:
    """Return the visual category for a person."""
    if name in explicit_ill:
        return "follow-up"
    if name in explicit_none:
        return "missing-advisor"
    if attrs.get("cmu", False):
        return "cmu-faculty"
    if name in roots:
        return "unknown-lineage"
    return "alumni"


def _sort_eras(eras: Iterable[str]) -> List[str]:
    order = ["Before 1980", "1980-1999", "2000-2009", "2010-2019", "2020-present", "Unknown year"]
    era_set = set(eras)
    return [era for era in order if era in era_set]


def _sort_roles(roles: Iterable[str]) -> List[str]:
    preferred = ["CMU faculty", "PhD alumni", "MS alumni", "Unlisted role"]
    role_set = set(roles)
    leading = [role for role in preferred if role in role_set]
    rest = sorted(role_set - set(leading), key=str.casefold)
    return leading + rest


def _known_year(attrs: Dict[str, Optional[object]]) -> Optional[int]:
    year = attrs.get("year")
    if not isinstance(year, int):
        year = to_int_or_none(year)
    return year if isinstance(year, int) and year >= 0 else None


def _relation_maps(
    names: Iterable[str],
    edges: Iterable[Tuple[str, str]],
) -> Tuple[Dict[str, List[str]], Dict[str, List[str]]]:
    incoming: Dict[str, List[str]] = {name: [] for name in names}
    outgoing: Dict[str, List[str]] = {name: [] for name in names}
    for advisor, advisee in edges:
        outgoing[advisor].append(advisee)
        incoming[advisee].append(advisor)
    for rels in (incoming, outgoing):
        for linked in rels.values():
            linked.sort(key=str.casefold)
    return incoming, outgoing


def _distance_to_faculty(
    incoming: Dict[str, List[str]],
    faculty: List[str],
) -> Dict[str, int]:
    distances = {name: 0 for name in faculty}
    queue: deque[str] = deque(faculty)
    while queue:
        node = queue.popleft()
        for advisor in incoming.get(node, []):
            candidate = distances[node] + 1
            if advisor not in distances or candidate < distances[advisor]:
                distances[advisor] = candidate
                queue.append(advisor)
    return distances


def _downstream_faculty_sets(
    incoming: Dict[str, List[str]],
    faculty: List[str],
) -> Dict[str, Set[str]]:
    downstream = {name: set() for name in incoming}
    queue: deque[str] = deque(faculty)
    for name in faculty:
        downstream[name].add(name)
    while queue:
        node = queue.popleft()
        for advisor in incoming.get(node, []):
            before = len(downstream[advisor])
            downstream[advisor].update(downstream[node])
            if len(downstream[advisor]) != before:
                queue.append(advisor)
    return downstream


def _root_depths(
    names: Iterable[str],
    incoming: Dict[str, List[str]],
    outgoing: Dict[str, List[str]],
) -> Dict[str, int]:
    node_names = list(names)
    indegree = {name: len(incoming.get(name, [])) for name in node_names}
    depths = {name: 0 for name in node_names}
    queue: deque[str] = deque(sorted((name for name in node_names if indegree[name] == 0), key=str.casefold))
    seen = 0
    while queue:
        node = queue.popleft()
        seen += 1
        for advisee in outgoing.get(node, []):
            depths[advisee] = max(depths[advisee], depths[node] + 1)
            indegree[advisee] -= 1
            if indegree[advisee] == 0:
                queue.append(advisee)

    if seen == len(node_names):
        return depths

    # Cycles are not expected in advisor data, but keep deterministic depths
    # rather than failing the build when the source sheet has a loop.
    for _ in range(len(node_names)):
        changed = False
        for advisor in sorted(node_names, key=str.casefold):
            for advisee in outgoing.get(advisor, []):
                candidate = depths[advisor] + 1
                if candidate > depths[advisee]:
                    depths[advisee] = candidate
                    changed = True
        if not changed:
            break
    return depths


def _temporal_rank(
    year: Optional[int],
    known_years: List[int],
    max_rank: int,
) -> Optional[int]:
    if year is None or not known_years or max_rank <= 0:
        return None
    low = known_years[0]
    high = known_years[-1]
    if high == low:
        return max_rank // 2
    fraction = (year - low) / (high - low)
    return max(0, min(max_rank, round(fraction * max_rank)))


def _rank_nodes(
    people: Dict[str, Dict[str, Optional[object]]],
    edges: Iterable[Tuple[str, str]],
) -> Tuple[Dict[str, int], Dict[str, float], int, Dict[str, Set[str]]]:
    names = sorted(people, key=str.casefold)
    incoming, outgoing = _relation_maps(names, edges)
    faculty = sorted(
        (name for name in names if people[name].get("cmu", False)),
        key=str.casefold,
    )
    known_years = sorted(
        year for year in (_known_year(attrs) for attrs in people.values()) if year is not None
    )
    root_depths = _root_depths(names, incoming, outgoing)

    if faculty:
        distances = _distance_to_faculty(incoming, faculty)
        max_distance = max(distances.values(), default=0)
        max_depth = max(root_depths.values(), default=0)
        bottom_rank = max(2, max_distance, max_depth)
        ranks: Dict[str, int] = {}
        for name in names:
            if name in faculty:
                ranks[name] = bottom_rank
                continue
            if name in distances:
                ranks[name] = max(0, bottom_rank - distances[name])
                continue
            year_rank = _temporal_rank(_known_year(people[name]), known_years, bottom_rank - 1)
            ranks[name] = year_rank if year_rank is not None else min(root_depths[name], bottom_rank - 1)
            ranks[name] = min(ranks[name], bottom_rank - 1)
        downstream_faculty = _downstream_faculty_sets(incoming, faculty)
    else:
        bottom_rank = max(1, max(root_depths.values(), default=0))
        ranks = {}
        for name in names:
            year_rank = _temporal_rank(_known_year(people[name]), known_years, bottom_rank)
            ranks[name] = year_rank if year_rank is not None else root_depths[name]
        downstream_faculty = {name: set() for name in names}

    for _ in range(len(names)):
        changed = False
        for advisor, advisee in edges:
            if advisor not in ranks or advisee not in ranks:
                continue
            if faculty and advisor in faculty and advisee not in faculty:
                continue
            if ranks[advisor] >= ranks[advisee]:
                if faculty and advisee in faculty:
                    next_rank = min(ranks[advisor], bottom_rank - 1)
                    if next_rank != ranks[advisor]:
                        ranks[advisor] = next_rank
                        changed = True
                elif not faculty or ranks[advisor] < bottom_rank - 1:
                    next_rank = min(bottom_rank - 1 if faculty else bottom_rank, ranks[advisor] + 1)
                    if next_rank > ranks[advisee]:
                        ranks[advisee] = next_rank
                        changed = True
        if not changed:
            break

    temporal_offsets: Dict[str, float] = {}
    for name in names:
        if faculty and name in faculty:
            temporal_offsets[name] = 0.0
            continue
        year_rank = _temporal_rank(_known_year(people[name]), known_years, bottom_rank)
        if year_rank is None or bottom_rank <= 0:
            temporal_offsets[name] = 0.0
            continue
        temporal_offsets[name] = max(-0.32, min(0.32, (year_rank - ranks[name]) * 0.18))

    return ranks, temporal_offsets, bottom_rank, downstream_faculty


def build_layout(
    people: Dict[str, Dict[str, Optional[object]]],
    edges: Iterable[Tuple[str, str]],
) -> Dict[str, Dict[str, object]]:
    """Build stable tree coordinates for the browser explorer.

    The layout is intentionally rank-based, echoing the earlier Graphviz
    output: advisor links define the broad top-to-bottom structure, known years
    nudge non-faculty within their rank, and current CMU faculty are pinned to
    a shared sink row.
    """
    names = sorted(people, key=str.casefold)
    ranks, temporal_offsets, bottom_rank, downstream_faculty = _rank_nodes(people, edges)
    faculty = sorted(
        (name for name in names if people[name].get("cmu", False)),
        key=str.casefold,
    )
    faculty_order = {name: idx for idx, name in enumerate(faculty)}
    horizontal_spacing = 230
    vertical_spacing = 175
    no_faculty_offset = len(faculty) + 1
    incoming, _ = _relation_maps(names, edges)

    anchors: Dict[str, float] = {}
    unresolved: List[str] = []
    for name in names:
        if name in faculty_order:
            anchors[name] = float(faculty_order[name])
            continue
        reachable = sorted(downstream_faculty.get(name, set()), key=str.casefold)
        if reachable:
            anchors[name] = sum(faculty_order[fac] for fac in reachable) / len(reachable)
            continue
        unresolved.append(name)

    for _ in range(len(names)):
        remaining: List[str] = []
        changed = False
        for name in unresolved:
            advisor_anchors = [anchors[advisor] for advisor in incoming.get(name, []) if advisor in anchors]
            if advisor_anchors:
                anchors[name] = sum(advisor_anchors) / len(advisor_anchors)
                changed = True
            else:
                remaining.append(name)
        unresolved = remaining
        if not changed:
            break

    for name in unresolved:
        year = _known_year(people[name])
        anchors[name] = no_faculty_offset + (0 if year is None else year / 10000)
        no_faculty_offset += 1

    rows: Dict[int, List[str]] = defaultdict(list)
    for name, rank in ranks.items():
        rows[rank].append(name)

    layout: Dict[str, Dict[str, object]] = {}
    for rank in sorted(rows):
        row = sorted(
            rows[rank],
            key=lambda name: (
                anchors[name],
                _known_year(people[name]) or 9999,
                name.casefold(),
            ),
        )
        previous_x: Optional[float] = None
        for index, name in enumerate(row):
            x = anchors[name] * horizontal_spacing
            if previous_x is not None and x - previous_x < horizontal_spacing * 0.72:
                x = previous_x + horizontal_spacing * 0.72
            previous_x = x
            layout[name] = {
                "x": round(x, 2),
                "y": round((rank + temporal_offsets.get(name, 0.0)) * vertical_spacing, 2),
                "rank": rank,
                "rowOrder": index,
                "facultySink": bool(faculty and name in faculty_order and rank == bottom_rank),
            }

    if faculty:
        row = sorted(faculty, key=lambda name: layout[name]["x"])
        for index, name in enumerate(row):
            layout[name]["rowOrder"] = index

    return layout


def build_graph_data(
    people: Dict[str, Dict[str, Optional[object]]],
    edges: Iterable[Tuple[str, str]],
    explicit_none: Set[str],
    explicit_ill: Set[str],
    skipped_rows: int = 0,
) -> Dict[str, object]:
    """Build the JSON payload used by the browser explorer."""
    renderable_people = {name: attrs for name, attrs in people.items() if clean_name(name) is not None}
    renderable_edges = [
        (advisor, advisee)
        for advisor, advisee in edges
        if advisor in renderable_people and advisee in renderable_people
    ]
    explicit_none = explicit_none & set(renderable_people)
    explicit_ill = explicit_ill & set(renderable_people)
    roots = find_roots(renderable_people, renderable_edges, explicit_none, explicit_ill)
    layout_by_name = build_layout(renderable_people, renderable_edges)

    ids_by_name = {name: stable_person_id(name) for name in sorted(renderable_people)}
    degree_counts = {name: 0 for name in renderable_people}
    for advisor, advisee in renderable_edges:
        degree_counts[advisor] += 1
        degree_counts[advisee] += 1

    nodes = []
    for name in sorted(renderable_people, key=str.casefold):
        attrs = renderable_people[name]
        year = attrs.get("year")
        if not isinstance(year, int):
            year = to_int_or_none(year)
        year_label = str(year) if isinstance(year, int) and year >= 0 else "Unknown year"
        role = role_for_person(attrs)
        era = era_for_year(year)
        category = category_for_person(name, attrs, roots, explicit_none, explicit_ill)
        nodes.append(
            {
                "id": ids_by_name[name],
                "name": name,
                "year": year if isinstance(year, int) and year >= 0 else None,
                "yearLabel": year_label,
                "title": attrs.get("title"),
                "role": role,
                "era": era,
                "category": category,
                "categoryLabel": CATEGORY_LABELS[category],
                "cmu": bool(attrs.get("cmu", False)),
                "degree": degree_counts[name],
                "layout": layout_by_name[name],
                "flags": {
                    "explicitNone": name in explicit_none,
                    "illRequest": name in explicit_ill,
                    "root": name in roots,
                },
            }
        )

    json_edges = []
    for idx, (advisor, advisee) in enumerate(renderable_edges):
        json_edges.append(
            {
                "id": f"e{idx}-{ids_by_name[advisor]}-{ids_by_name[advisee]}",
                "source": ids_by_name[advisor],
                "target": ids_by_name[advisee],
                "advisorName": advisor,
                "adviseeName": advisee,
                "type": "advisor",
            }
        )

    years = sorted(
        node["year"]
        for node in nodes
        if isinstance(node.get("year"), int) and int(node["year"]) >= 0
    )
    eras = _sort_eras(node["era"] for node in nodes)
    roles = _sort_roles(node["role"] for node in nodes)
    categories = [
        {"id": category, "label": label}
        for category, label in CATEGORY_LABELS.items()
        if any(node["category"] == category for node in nodes)
    ]

    return {
        "meta": {
            "schemaVersion": 1,
            "source": "CMU MechE family tree CSV",
            "nodeCount": len(nodes),
            "edgeCount": len(json_edges),
            "skippedRows": skipped_rows,
            "facultyCount": sum(1 for node in nodes if node["category"] == "cmu-faculty"),
            "followUpCount": sum(1 for node in nodes if node["category"] == "follow-up"),
            "missingAdvisorCount": sum(1 for node in nodes if node["category"] == "missing-advisor"),
            "yearRange": [years[0], years[-1]] if years else None,
            "layout": {
                "name": "advisor-temporal-sink",
                "rankDirection": "TB",
                "facultySink": True,
            },
        },
        "filters": {
            "eras": eras,
            "roles": roles,
            "categories": categories,
        },
        "roots": [ids_by_name[name] for name in sorted(roots, key=str.casefold)],
        "nodes": nodes,
        "edges": json_edges,
    }


def write_graph_data(graph_data: Dict[str, object], output_path: str) -> None:
    """Write graph data JSON."""
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(graph_data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Saved: {path}")


def main(argv: Optional[List[str]] = None) -> None:
    parser = argparse.ArgumentParser(
        description="Generate browser-consumable family tree JSON from a CSV file.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--csv",
        dest="csv_path",
        required=True,
        help="Path or URL to a CSV file containing generation, advisee, advisor, title, and year.",
    )
    parser.add_argument(
        "--output-json",
        dest="output_json",
        default=None,
        help="Path for the generated graph JSON.",
    )
    parser.add_argument(
        "--output-basename",
        dest="output_basename",
        default=None,
        help="Deprecated compatibility option. Writes <basename>.json when --output-json is omitted.",
    )
    args = parser.parse_args(argv)

    df = pd.read_csv(args.csv_path, keep_default_na=False)
    df.columns = [norm(c) for c in df.columns]

    required_cols = {"generation", "advisee", "advisor", "title", "year"}
    missing = required_cols - set(df.columns)
    if missing:
        raise ValueError(f"Missing required columns: {missing}. Found columns: {list(df.columns)}")

    people, edges, explicit_none, explicit_ill, skipped_rows = build_graph(df)
    if skipped_rows:
        print(f"Skipped {skipped_rows} rows because advisee values were missing/placeholder.")

    impute_years(people, placeholder=-1)
    graph_data = build_graph_data(people, edges, explicit_none, explicit_ill, skipped_rows)

    output_json = args.output_json
    if output_json is None:
        output_json = f"{args.output_basename or 'family_tree'}.json"
    write_graph_data(graph_data, output_json)


if __name__ == "__main__":  # pragma: no cover
    main()
