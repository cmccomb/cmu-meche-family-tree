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
the exported data preserves a stable advisor-sensitive radial layout.
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
import networkx as nx


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

    edges = _drop_reciprocal_edges(list(dict.fromkeys(edges)), people)
    return people, edges, explicit_none, explicit_ill_request, skipped_rows


def _drop_reciprocal_edges(
    edges: List[Tuple[str, str]],
    people: Dict[str, Dict[str, Optional[object]]],
) -> List[Tuple[str, str]]:
    """Collapse mutual advisor pairs to the older-to-newer direction."""
    edge_set = set(edges)
    dropped: Set[Tuple[str, str]] = set()
    for advisor, advisee in edges:
        reverse = (advisee, advisor)
        if reverse not in edge_set or (advisor, advisee) in dropped or reverse in dropped:
            continue
        advisor_year = _known_year(people.get(advisor, {}))
        advisee_year = _known_year(people.get(advisee, {}))
        if advisor_year is not None and advisee_year is not None and advisor_year != advisee_year:
            drop = (advisor, advisee) if advisor_year > advisee_year else reverse
        else:
            drop = max((advisor, advisee), reverse, key=lambda edge: (edge[0].casefold(), edge[1].casefold()))
        dropped.add(drop)
    return [edge for edge in edges if edge not in dropped]


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


def _lineage_ordered_faculty(
    names: List[str],
    people: Dict[str, Dict[str, Optional[object]]],
    incoming: Dict[str, List[str]],
    outgoing: Dict[str, List[str]],
    downstream_faculty: Dict[str, Set[str]],
    faculty: List[str],
) -> List[str]:
    """Order current faculty so nearby angular wedges share ancestors."""
    faculty_set = set(faculty)
    emitted: Set[str] = set()
    ordered: List[str] = []

    def branch_sort_key(name: str) -> Tuple[int, int, str, str]:
        reachable = downstream_faculty.get(name, set()) & faculty_set
        years = [_known_year(people[fac]) for fac in reachable]
        known_years = [year for year in years if year is not None]
        lineage_name = min((fac.casefold() for fac in reachable), default=name.casefold())
        own_year = _known_year(people[name])
        return (
            0 if reachable or name in faculty_set else 1,
            min(known_years) if known_years else (own_year if own_year is not None else 9999),
            lineage_name,
            name.casefold(),
        )

    def visit(name: str, visiting: Set[str]) -> None:
        if name in visiting:
            return
        visiting.add(name)
        if name in faculty_set and name not in emitted:
            emitted.add(name)
            ordered.append(name)
        children = [
            child
            for child in outgoing.get(name, [])
            if child in faculty_set or downstream_faculty.get(child)
        ]
        for child in sorted(children, key=branch_sort_key):
            visit(child, visiting)
        visiting.remove(name)

    roots = sorted((name for name in names if not incoming.get(name)), key=branch_sort_key)
    for root in roots:
        visit(root, set())
    for name in sorted(names, key=branch_sort_key):
        visit(name, set())

    for name in sorted(faculty_set - emitted, key=str.casefold):
        ordered.append(name)
    return ordered


def _normalize_angle(angle: float) -> float:
    return angle % math.tau


def _centered_angle(angle: float) -> float:
    return (angle + math.pi) % math.tau - math.pi


def _angle_for_index(index: int, total: int) -> float:
    if total <= 1:
        return -math.pi / 2
    return (index / total) * math.tau - math.pi / 2


def _circular_mean(angles: Iterable[float], fallback: float = -math.pi / 2) -> float:
    angles = list(angles)
    if not angles:
        return fallback
    x = sum(math.cos(angle) for angle in angles)
    y = sum(math.sin(angle) for angle in angles)
    if abs(x) < 1e-7 and abs(y) < 1e-7:
        return fallback
    return math.atan2(y, x)


def _stable_unit(name: str) -> float:
    digest = hashlib.sha1(name.encode("utf-8")).hexdigest()[:8]
    return int(digest, 16) / 0xFFFFFFFF


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
    graph = nx.DiGraph()
    graph.add_nodes_from(names)
    graph.add_edges_from((advisor, advisee) for advisor, advisee in edges if advisor in people and advisee in people)
    components = list(nx.strongly_connected_components(graph))
    condensed = nx.condensation(graph, scc=components)
    component_for_name = condensed.graph.get("mapping", {})
    component_members = {
        component: set(condensed.nodes[component].get("members", set()))
        for component in condensed.nodes
    }
    component_base_rank = {component: 0 for component in condensed.nodes}
    for component in nx.topological_sort(condensed):
        for successor in condensed.successors(component):
            component_base_rank[successor] = max(
                component_base_rank[successor],
                component_base_rank[component] + 1,
            )

    faculty = sorted(
        (name for name in names if people[name].get("cmu", False)),
        key=str.casefold,
    )
    known_years = sorted(
        year for year in (_known_year(attrs) for attrs in people.values()) if year is not None
    )
    downstream_faculty = _downstream_faculty_sets(incoming, faculty) if faculty else {name: set() for name in names}

    structural_outer = max(component_base_rank.values(), default=0)
    temporal_outer = max(5, structural_outer)
    faculty_floor = temporal_outer if faculty else 0

    component_rank: Dict[int, int] = {}
    for component, members in component_members.items():
        rank = component_base_rank[component]
        years = [_known_year(people[name]) for name in members]
        known_component_years = sorted(year for year in years if year is not None)
        median_year = (
            known_component_years[len(known_component_years) // 2]
            if known_component_years
            else None
        )
        year_rank = _temporal_rank(median_year, known_years, temporal_outer)
        is_isolated = condensed.in_degree(component) == 0 and condensed.out_degree(component) == 0
        if is_isolated and year_rank is not None:
            rank = year_rank
        if any(people[name].get("cmu", False) for name in members):
            rank = max(rank, faculty_floor)
        component_rank[component] = rank

    # The condensation graph is acyclic, so this produces the minimum outward
    # ranks that satisfy all non-cyclic advisor edges.
    for component in nx.topological_sort(condensed):
        for successor in condensed.successors(component):
            component_rank[successor] = max(component_rank[successor], component_rank[component] + 1)

    ranks = {name: component_rank[component_for_name[name]] for name in names}

    outer_rank = max(ranks.values(), default=0)
    temporal_offsets = {name: 0.0 for name in names}
    return ranks, temporal_offsets, outer_rank, downstream_faculty


def build_layout(
    people: Dict[str, Dict[str, Optional[object]]],
    edges: Iterable[Tuple[str, str]],
) -> Dict[str, Dict[str, object]]:
    """Build stable tree coordinates for the browser explorer.

    The layout is radial and outward-directed: old roots sit near the center,
    advisor-to-advisee edges move to larger radii, and broad lineages occupy
    contiguous angular wedges instead of strict horizontal layers.
    """
    names = sorted(people, key=str.casefold)
    ranks, _, outer_rank, downstream_faculty = _rank_nodes(people, edges)
    faculty = sorted(
        (name for name in names if people[name].get("cmu", False)),
        key=str.casefold,
    )
    incoming, outgoing = _relation_maps(names, edges)
    ordered_faculty = _lineage_ordered_faculty(names, people, incoming, outgoing, downstream_faculty, faculty)
    faculty_order = {name: idx for idx, name in enumerate(ordered_faculty)}

    def branch_sort_key(name: str) -> Tuple[int, float, int, str]:
        reachable = sorted(downstream_faculty.get(name, set()), key=lambda fac: faculty_order.get(fac, 10_000))
        if reachable:
            anchor = sum(faculty_order[fac] for fac in reachable) / len(reachable)
            return (0, anchor, _known_year(people[name]) or 9999, name.casefold())
        return (1, float(ranks.get(name, 0)), _known_year(people[name]) or 9999, name.casefold())

    anchors = {name for name in names if not outgoing.get(name)}
    anchors.update(faculty)
    if not anchors:
        anchors.update(names)

    ordered_anchors: List[str] = []
    emitted_anchors: Set[str] = set()

    def emit_anchor_order(name: str, visiting: Set[str]) -> None:
        if name in visiting:
            return
        visiting.add(name)
        if name in anchors and name not in emitted_anchors:
            emitted_anchors.add(name)
            ordered_anchors.append(name)
        for child in sorted(outgoing.get(name, []), key=branch_sort_key):
            emit_anchor_order(child, visiting)
        visiting.remove(name)

    roots = sorted((name for name in names if not incoming.get(name)), key=branch_sort_key)
    for root in roots:
        emit_anchor_order(root, set())
    for name in sorted(names, key=branch_sort_key):
        emit_anchor_order(name, set())

    for name in sorted(anchors - emitted_anchors, key=str.casefold):
        ordered_anchors.append(name)

    angles: Dict[str, float] = {
        name: _angle_for_index(index, len(ordered_anchors))
        for index, name in enumerate(ordered_anchors)
    }

    for _ in range(len(names)):
        changed = False
        for name in sorted(names, key=lambda node: (-ranks.get(node, 0), node.casefold())):
            if name in angles:
                continue
            linked_angles = [angles[child] for child in outgoing.get(name, []) if child in angles]
            if not linked_angles:
                linked_angles = [angles[advisor] for advisor in incoming.get(name, []) if advisor in angles]
            if linked_angles:
                angles[name] = _circular_mean(linked_angles)
                changed = True
        if not changed:
            break

    for name in names:
        if name not in angles:
            angles[name] = _normalize_angle(_stable_unit(name) * math.tau - math.pi / 2)

    fixed_angles = set(ordered_anchors)
    for _ in range(8):
        next_angles = angles.copy()
        for name in names:
            if name in fixed_angles:
                continue
            linked_angles: List[float] = []
            linked_angles.extend(angles[advisor] for advisor in incoming.get(name, []) if advisor in angles)
            for child in outgoing.get(name, []):
                if child in angles:
                    linked_angles.extend([angles[child], angles[child]])
            if linked_angles:
                next_angles[name] = _circular_mean(linked_angles, angles[name])
        angles = next_angles

    rows: Dict[int, List[str]] = defaultdict(list)
    for name, rank in ranks.items():
        rows[rank].append(name)

    ordered_rows: Dict[int, List[str]] = {}
    for rank in sorted(rows):
        ordered_rows[rank] = sorted(
            rows[rank],
            key=lambda name: (
                _normalize_angle(angles[name]),
                _known_year(people[name]) or 9999,
                name.casefold(),
            ),
        )

    layout_graph = nx.DiGraph()
    layout_graph.add_nodes_from(names)
    layout_graph.add_edges_from((advisor, advisee) for advisor, advisee in edges if advisor in people and advisee in people)
    shells = [ordered_rows[rank] for rank in range(outer_rank + 1) if ordered_rows.get(rank)]
    if shells:
        shell_positions = nx.shell_layout(layout_graph, nlist=shells, scale=1, center=(0, 0))
        library_positions = {
            name: [float(position[0]), float(position[1])]
            for name, position in shell_positions.items()
        }
        for name, position in library_positions.items():
            x = float(position[0])
            y = float(position[1])
            if math.isfinite(x) and math.isfinite(y) and (abs(x) > 1e-9 or abs(y) > 1e-9):
                angles[name] = math.atan2(y, x)

    base_radius = 118.0
    ring_gap = 112.0
    lane_gap = 104.0
    min_arc_gap = 52.0
    node_radii: Dict[str, float] = {}
    previous_outer_radius = 0.0
    for rank in sorted(rows):
        row = ordered_rows[rank]
        count = max(1, len(row))
        lane_count = max(1, math.ceil(count / 42))
        lane_sizes = [sum(1 for index in range(count) if index % lane_count == lane) for lane in range(lane_count)]
        lane_radii: List[float] = []
        rank_base = base_radius if previous_outer_radius == 0 else previous_outer_radius + ring_gap
        for lane, lane_size in enumerate(lane_sizes):
            radius_for_count = (max(1, lane_size) * min_arc_gap) / math.tau
            min_radius = rank_base + lane * lane_gap
            if lane_radii:
                min_radius = max(min_radius, lane_radii[-1] + lane_gap)
            lane_radii.append(max(min_radius, radius_for_count))
        for index, name in enumerate(row):
            node_radii[name] = lane_radii[index % lane_count]
        previous_outer_radius = max(lane_radii)

    layout: Dict[str, Dict[str, object]] = {}
    for rank in sorted(ordered_rows):
        row = ordered_rows[rank]
        for index, name in enumerate(row):
            angle = _centered_angle(angles[name])
            radius = node_radii[name]
            x = radius * math.cos(angle)
            y = radius * math.sin(angle)
            layout[name] = {
                "x": round(x, 2),
                "y": round(y, 2),
                "rank": rank,
                "radius": round(radius, 2),
                "angle": round(math.degrees(angle), 2),
                "rowOrder": index,
                "facultySink": False,
                "facultyPerimeter": bool(name in faculty and rank >= max(0, outer_rank - 1)),
            }

    if faculty:
        row = sorted(faculty, key=lambda name: _normalize_angle(angles[name]))
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
                "name": "advisor-radial-shell",
                "rankDirection": "outward",
                "facultySink": False,
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
