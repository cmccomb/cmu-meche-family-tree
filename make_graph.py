#!/usr/bin/env python3
"""Build structured data for the CMU MechE academic family tree site.

The input CSV is expected to contain these columns, with case and whitespace
ignored:

```
generation, advisee, advisor, title, university, country, continent, year
```

Each row defines an advisee, their advisor(s), an optional title or degree, and
the year the advisee received that degree. Advisors can be listed as a single
name or as multiple names separated by semicolons, commas, or line breaks.
Country and continent labels are read directly from the spreadsheet when present.

The script writes a JSON file consumed by the browser-based explorer. Graph
filtering, search, path finding, and branch focus happen in JavaScript, while
the exported data preserves a stable advisor-sensitive layered tree layout.
"""

from __future__ import annotations

import argparse
from collections import defaultdict, deque
import hashlib
import json
import math
import re
import subprocess
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

NULL_BUCKET_LABEL = "Unknown / none"

SOURCE_COLUMN_LABELS = {
    "source": "Source",
    "sources": "Source",
    "wikipedia": "Wikipedia",
    "wikipedia url": "Wikipedia",
    "wikipedia_url": "Wikipedia",
    "mathematics genealogy project": "MGP",
    "mathematics_genealogy_project": "MGP",
    "math genealogy project": "MGP",
    "math_genealogy_project": "MGP",
    "math genealogy": "MGP",
    "math_genealogy": "MGP",
    "mgp": "MGP",
    "academic family tree": "Academic Family Tree",
    "academic_family_tree": "Academic Family Tree",
    "thesis": "Thesis",
    "other": "Other",
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


def clean_optional_text(s: object) -> Optional[str]:
    """Normalize optional text fields without treating them as person names."""
    normalized = _normalize_token(s)
    if not normalized or normalized.casefold() in PLACEHOLDER_TOKENS:
        return None
    return normalized


def primary_university(value: Optional[object]) -> str:
    """Return a compact primary university label for color grouping."""
    text = clean_optional_text(value)
    if not text:
        return "Unknown university"
    parts = [part.strip() for part in re.split(r"\s*;\s*|\s+ and \s+", text) if part.strip()]
    return parts[0] if parts else text


def country_label_from_sheet(value: Optional[object]) -> str:
    """Return the country label supplied by the source spreadsheet."""
    return clean_optional_text(value) or "Unknown country"


def continent_label_from_sheet(value: Optional[object]) -> str:
    """Return the continent label supplied by the source spreadsheet."""
    return clean_optional_text(value) or NULL_BUCKET_LABEL


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


def source_url_from_value(value: str, label: str) -> Optional[str]:
    raw = value.strip()
    if raw == "":
        return None
    if re.match(r"https?://", raw, flags=re.IGNORECASE):
        return raw
    if raw.casefold().startswith("www."):
        return f"https://{raw}"
    if raw.casefold().startswith("doi:"):
        doi = raw.split(":", 1)[1].strip()
        return f"https://doi.org/{doi}" if doi else None
    if re.match(r"^10\.\d{4,9}/\S+$", raw):
        return f"https://doi.org/{raw}"
    if label == "MGP":
        mgp_id = to_int_or_none(raw)
        if mgp_id is not None:
            return f"https://www.mathgenealogy.org/id.php?id={mgp_id}"
    return None


def source_entries_from_cell(value: object, label: str) -> List[Dict[str, str]]:
    if value is None or pd.isna(value):
        return []
    raw = str(value).strip()
    if raw == "" or raw.casefold() in PLACEHOLDER_TOKENS:
        return []

    parts = [part.strip() for part in re.split(r"[;\n]+", raw) if part.strip()]
    if len(parts) == 1:
        parts = [raw]

    entries: List[Dict[str, str]] = []
    for part in parts:
        url = source_url_from_value(part, label)
        if not url:
            continue
        entries.append({"label": label, "url": url})
    return entries


def source_entries_from_row(row: pd.Series) -> List[Dict[str, str]]:
    entries: List[Dict[str, str]] = []
    for column, value in row.items():
        label = SOURCE_COLUMN_LABELS.get(str(column).strip().casefold())
        if not label:
            continue
        entries.extend(source_entries_from_cell(value, label))
    return dedupe_source_entries(entries)


def dedupe_source_entries(entries: Iterable[Dict[str, str]]) -> List[Dict[str, str]]:
    deduped: List[Dict[str, str]] = []
    seen: Set[Tuple[str, str]] = set()
    for entry in entries:
        label = str(entry.get("label", "")).strip()
        url = str(entry.get("url", "")).strip()
        if not label or not url:
            continue
        key = (label.casefold(), url)
        if key in seen:
            continue
        seen.add(key)
        deduped.append({"label": label, "url": url})
    return deduped


def merge_source_entries(
    existing: Optional[object],
    incoming: Iterable[Dict[str, str]],
) -> List[Dict[str, str]]:
    base = existing if isinstance(existing, list) else []
    return dedupe_source_entries([*base, *incoming])


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
        source_generation = to_int_or_none(r.get("generation", None))
        cmu = is_cmu_faculty_marker(r.get("generation", None))
        title = None if pd.isna(r.get("title", None)) else str(r.get("title", None)).strip()
        if title == "":
            title = None
        university = clean_optional_text(r.get("university", None))
        country = clean_optional_text(r.get("country", None))
        continent = clean_optional_text(r.get("continent", None))
        sources = source_entries_from_row(r)

        if advisee is None:
            skipped_rows += 1
            continue

        if advisee not in people:
            people[advisee] = {
                "year": year,
                "cmu": cmu,
                "title": title,
                "generation": source_generation,
                "university": university,
                "country": country,
                "continent": continent,
                "sources": sources,
            }
        else:
            if people[advisee]["year"] is None and year is not None:
                people[advisee]["year"] = year
            people[advisee]["cmu"] = bool(people[advisee]["cmu"]) or cmu
            if not people[advisee]["title"] and title:
                people[advisee]["title"] = title
            if not people[advisee].get("university") and university:
                people[advisee]["university"] = university
            if not people[advisee].get("country") and country:
                people[advisee]["country"] = country
            if not people[advisee].get("continent") and continent:
                people[advisee]["continent"] = continent
            people[advisee]["sources"] = merge_source_entries(people[advisee].get("sources"), sources)
            existing_generation = to_int_or_none(people[advisee].get("generation"))
            if source_generation is not None:
                people[advisee]["generation"] = max(
                    existing_generation if existing_generation is not None else source_generation,
                    source_generation,
                )

        for advisor in advisors:
            if advisor not in people:
                people[advisor] = {
                    "year": None,
                    "cmu": False,
                    "title": None,
                    "generation": None,
                    "university": None,
                    "country": None,
                    "continent": None,
                    "sources": [],
                }
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
    if normalized in {"ms", "msc", "mse", "master", "masters", "masterofscience"}:
        return "Unlisted role"
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
    preferred = ["CMU faculty", "PhD alumni", "Unlisted role"]
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


def _faculty_peer_component_order(
    component: Set[str],
    peer_graph: nx.Graph,
    original_order: Dict[str, int],
) -> List[str]:
    if len(component) <= 1:
        return sorted(component, key=lambda name: (original_order.get(name, 0), name.casefold()))

    def order_score(order: List[str]) -> Tuple[int, Tuple[int, ...], Tuple[str, ...]]:
        return (
            sum(abs(index - original_order.get(name, index)) for index, name in enumerate(order)),
            tuple(original_order.get(name, 0) for name in order),
            tuple(name.casefold() for name in order),
        )

    degrees = {name: peer_graph.degree(name) for name in component}
    is_path = peer_graph.subgraph(component).number_of_edges() == len(component) - 1 and max(degrees.values()) <= 2
    if is_path:
        endpoints = [name for name, degree in degrees.items() if degree <= 1]
        start = min(endpoints or list(component), key=lambda name: (original_order.get(name, 0), name.casefold()))
        ordered = [start]
        previous: Optional[str] = None
        current = start
        while len(ordered) < len(component):
            candidates = [
                neighbor
                for neighbor in peer_graph.neighbors(current)
                if neighbor != previous and neighbor in component and neighbor not in ordered
            ]
            if not candidates:
                break
            previous, current = current, min(
                candidates,
                key=lambda name: (original_order.get(name, 0), name.casefold()),
            )
            ordered.append(current)
        if len(ordered) == len(component):
            reversed_order = list(reversed(ordered))
            return min((ordered, reversed_order), key=order_score)

    root = min(component, key=lambda name: (original_order.get(name, 0), name.casefold()))
    ordered = []
    seen: Set[str] = set()

    def visit(name: str) -> None:
        seen.add(name)
        ordered.append(name)
        neighbors = [
            neighbor
            for neighbor in peer_graph.neighbors(name)
            if neighbor in component and neighbor not in seen
        ]
        for neighbor in sorted(neighbors, key=lambda item: (original_order.get(item, 0), item.casefold())):
            visit(neighbor)

    visit(root)
    for name in sorted(component - seen, key=lambda item: (original_order.get(item, 0), item.casefold())):
        visit(name)
    return ordered


def _faculty_peer_adjacent_order(
    ordered_faculty: List[str],
    edges: Iterable[Tuple[str, str]],
) -> List[str]:
    """Keep faculty advisor links adjacent when faculty share the sink row."""
    faculty_set = set(ordered_faculty)
    peer_graph = nx.Graph()
    peer_graph.add_nodes_from(ordered_faculty)
    peer_graph.add_edges_from(
        (advisor, advisee)
        for advisor, advisee in edges
        if advisor in faculty_set and advisee in faculty_set
    )
    if not peer_graph.number_of_edges():
        return ordered_faculty

    original_order = {name: index for index, name in enumerate(ordered_faculty)}
    components = []
    for component in nx.connected_components(peer_graph):
        component_order = _faculty_peer_component_order(set(component), peer_graph, original_order)
        components.append(
            (
                sum(original_order[name] for name in component_order) / len(component_order),
                min(original_order[name] for name in component_order),
                component_order,
            )
        )
    components.sort(key=lambda item: (item[0], item[1], item[2][0].casefold()))
    return [name for _, _, component_order in components for name in component_order]


def _source_generation(attrs: Dict[str, Optional[object]]) -> Optional[int]:
    return to_int_or_none(attrs.get("generation"))


def _infer_tree_generations(
    people: Dict[str, Dict[str, Optional[object]]],
    edges: Iterable[Tuple[str, str]],
) -> Dict[str, int]:
    """Infer top-to-bottom tree layers from source generations and edges."""
    names = sorted(people, key=str.casefold)
    graph = nx.DiGraph()
    graph.add_nodes_from(names)
    graph.add_edges_from((advisor, advisee) for advisor, advisee in edges if advisor in people and advisee in people)

    components = list(nx.strongly_connected_components(graph))
    condensed = nx.condensation(graph, scc=components)
    component_for_name = condensed.graph.get("mapping", {})

    component_generation: Dict[int, Optional[int]] = {}
    for component in condensed.nodes:
        members = condensed.nodes[component].get("members", set())
        known_generations = [
            generation
            for generation in (_source_generation(people[name]) for name in members)
            if generation is not None
        ]
        component_generation[component] = max(known_generations) if known_generations else None

    # Advisor -> student edges should always move downward. Source generations
    # are mostly already adjacent, but this pass fixes missing advisor-only
    # nodes and inconsistent duplicate depths without dropping relationships.
    for component in reversed(list(nx.topological_sort(condensed))):
        inferred = component_generation[component]
        generation = inferred if inferred is not None else 0
        for successor in condensed.successors(component):
            successor_generation = component_generation.get(successor)
            generation = max(generation, (successor_generation if successor_generation is not None else 0) + 1)
        component_generation[component] = generation

    return {
        name: int(component_generation[component_for_name[name]] or 0)
        for name in names
    }


def _component_downstream_faculty(
    names: Iterable[str],
    edges: Iterable[Tuple[str, str]],
    downstream_faculty: Dict[str, Set[str]],
) -> Tuple[Dict[str, int], Dict[int, Set[str]]]:
    graph = nx.Graph()
    graph.add_nodes_from(names)
    graph.add_edges_from(edges)

    component_by_name: Dict[str, int] = {}
    faculty_by_component: Dict[int, Set[str]] = {}
    components = list(nx.connected_components(graph))
    for index, component in enumerate(components):
        faculty_set: Set[str] = set()
        for name in component:
            component_by_name[name] = index
            faculty_set.update(downstream_faculty.get(name, set()))
        faculty_by_component[index] = faculty_set

    return component_by_name, faculty_by_component


def _resolve_layer_positions(
    row: List[str],
    target_x: Dict[str, float],
    min_gap: float,
) -> Dict[str, float]:
    """Place a row near target x positions while enforcing node separation."""
    if not row:
        return {}

    ordered = sorted(row, key=lambda name: (target_x[name], name.casefold()))
    clusters = [
        {
            "items": [name],
            "target_sum": target_x[name],
        }
        for name in ordered
    ]

    def cluster_center(cluster: Dict[str, object]) -> float:
        return float(cluster["target_sum"]) / len(cluster["items"])  # type: ignore[arg-type]

    def cluster_bounds(cluster: Dict[str, object]) -> Tuple[float, float]:
        count = len(cluster["items"])  # type: ignore[arg-type]
        center = cluster_center(cluster)
        half_width = min_gap * (count - 1) / 2
        return center - half_width, center + half_width

    index = 0
    while index < len(clusters) - 1:
        left = clusters[index]
        right = clusters[index + 1]
        _, left_right = cluster_bounds(left)
        right_left, _ = cluster_bounds(right)
        if left_right + min_gap > right_left:
            left["items"].extend(right["items"])  # type: ignore[union-attr]
            left["target_sum"] = float(left["target_sum"]) + float(right["target_sum"])
            clusters.pop(index + 1)
            index = max(0, index - 1)
        else:
            index += 1

    positions: Dict[str, float] = {}
    for cluster in clusters:
        items = cluster["items"]  # type: ignore[assignment]
        center = cluster_center(cluster)
        start = center - min_gap * (len(items) - 1) / 2
        for item_index, name in enumerate(items):
            positions[name] = start + item_index * min_gap

    return positions


def _build_anchor_layout(
    people: Dict[str, Dict[str, Optional[object]]],
    edges: Iterable[Tuple[str, str]],
) -> Dict[str, Dict[str, object]]:
    """Build stable tree coordinates for the browser explorer.

    The layout is a layered advisor tree: older ancestors are placed in upper
    rows, CMU faculty lineages are grouped into stable horizontal branches, and
    each advisor sits near the barycenter of downstream faculty descendants.
    """
    edge_list = list(edges)
    names = sorted(people, key=str.casefold)
    faculty = sorted(
        (name for name in names if people[name].get("cmu", False)),
        key=str.casefold,
    )
    faculty_set = set(faculty)
    vertical_edges = [
        (advisor, advisee)
        for advisor, advisee in edge_list
        if not (advisor in faculty_set and advisee in faculty_set)
    ]
    generations = _infer_tree_generations(people, vertical_edges)
    for name in faculty:
        generations[name] = 0
    max_generation = max(generations.values(), default=0)
    incoming, outgoing = _relation_maps(names, edge_list)
    downstream_faculty = _downstream_faculty_sets(incoming, faculty) if faculty else {name: set() for name in names}
    ordered_faculty = _faculty_peer_adjacent_order(
        _lineage_ordered_faculty(names, people, incoming, outgoing, downstream_faculty, faculty),
        edge_list,
    )
    faculty_order = {name: idx for idx, name in enumerate(ordered_faculty)}

    component_by_name, faculty_by_component = _component_downstream_faculty(names, edge_list, downstream_faculty)
    fallback_components = sorted(
        set(component_by_name.values()),
        key=lambda component: (
            0 if faculty_by_component.get(component) else 1,
            min((generations.get(name, 0) for name, value in component_by_name.items() if value == component), default=0),
            min((name.casefold() for name, value in component_by_name.items() if value == component), default=""),
        ),
    )
    component_order = {component: index for index, component in enumerate(fallback_components)}

    def branch_anchor(name: str) -> float:
        if name in faculty_order:
            return float(faculty_order[name])
        reachable = downstream_faculty.get(name, set())
        if not reachable:
            reachable = faculty_by_component.get(component_by_name.get(name, -1), set())
        reachable = {faculty_name for faculty_name in reachable if faculty_name in faculty_order}
        if reachable:
            return sum(faculty_order[faculty_name] for faculty_name in reachable) / len(reachable)
        return len(ordered_faculty) + component_order.get(component_by_name.get(name, -1), 0)

    rows: Dict[int, List[str]] = defaultdict(list)
    for name, generation in generations.items():
        rows[generation].append(name)

    ordered_rows: Dict[int, List[str]] = {}
    target_x: Dict[str, float] = {}
    anchor_gap = 246.0
    row_gap = 168.0
    min_node_gap = 178.0
    faculty_center = (max(1, len(ordered_faculty)) - 1) / 2

    for name in names:
        target_x[name] = (branch_anchor(name) - faculty_center) * anchor_gap

    x_positions: Dict[str, float] = {}
    for rank in sorted(rows):
        ordered_rows[rank] = sorted(
            rows[rank],
            key=lambda name: (
                branch_anchor(name),
                _known_year(people[name]) or 9999,
                name.casefold(),
            ),
        )
        x_positions.update(_resolve_layer_positions(ordered_rows[rank], target_x, min_node_gap))

    layout: Dict[str, Dict[str, object]] = {}
    for generation in sorted(ordered_rows):
        row = ordered_rows[generation]
        top_rank = max_generation - generation
        for index, name in enumerate(row):
            x = x_positions.get(name, target_x[name])
            y = (top_rank - max_generation / 2) * row_gap
            layout[name] = {
                "x": round(x, 2),
                "y": round(y, 2),
                "rank": int(top_rank),
                "generation": int(generation),
                "sourceGeneration": _source_generation(people[name]),
                "branchAnchor": round(branch_anchor(name), 3),
                "rowOrder": index,
                "facultySink": bool(name in faculty_set),
                "facultyPerimeter": bool(name in faculty),
            }

    return layout


def _layout_node_size(name: str, attrs: Dict[str, Optional[object]], degree: int) -> Tuple[float, float]:
    """Return the rendered Cytoscape node size used by the browser."""
    is_faculty = bool(attrs.get("cmu", False))
    width = max(148.0 if is_faculty else 132.0, min(172.0, 124.0 + math.sqrt(degree + 1) * 11.0))
    height = 58.0 if is_faculty else 52.0
    return width, height


def _repo_root() -> Path:
    return Path(__file__).resolve().parent


def _build_elk_layout(
    people: Dict[str, Dict[str, Optional[object]]],
    edges: Iterable[Tuple[str, str]],
    fallback_layout: Dict[str, Dict[str, object]],
) -> Dict[str, Dict[str, object]]:
    names = sorted(people, key=str.casefold)
    edge_list = list(edges)
    ids_by_name = {name: stable_person_id(name) for name in names}
    names_by_id = {node_id: name for name, node_id in ids_by_name.items()}
    degree_counts = {name: 0 for name in names}
    for advisor, advisee in edge_list:
        if advisor in degree_counts:
            degree_counts[advisor] += 1
        if advisee in degree_counts:
            degree_counts[advisee] += 1

    node_records = []
    for name in sorted(
        names,
        key=lambda item: (
            int(fallback_layout[item].get("rank", 0)),
            int(fallback_layout[item].get("rowOrder", 0)),
            item.casefold(),
        ),
    ):
        width, height = _layout_node_size(name, people[name], degree_counts[name])
        node_records.append(
            {
                "id": ids_by_name[name],
                "name": name,
                "width": width,
                "height": height,
                "facultySink": bool(people[name].get("cmu", False)),
            }
        )

    faculty_set = {name for name in names if people[name].get("cmu", False)}
    edge_records = []
    for index, (advisor, advisee) in enumerate(edge_list):
        if advisor not in ids_by_name or advisee not in ids_by_name:
            continue
        if advisor in faculty_set and advisee in faculty_set:
            continue
        edge_records.append(
            {
                "id": f"e{index}",
                "source": ids_by_name[advisor],
                "target": ids_by_name[advisee],
            }
        )

    script_path = _repo_root() / "scripts" / "elk_layout.js"
    if not script_path.exists():
        raise RuntimeError(f"ELK layout script not found: {script_path}")

    request = {"nodes": node_records, "edges": edge_records}
    try:
        completed = subprocess.run(
            ["node", str(script_path)],
            input=json.dumps(request),
            text=True,
            capture_output=True,
            check=True,
            cwd=str(_repo_root()),
        )
    except FileNotFoundError as exc:
        raise RuntimeError("Node.js is required for the ELK layout engine.") from exc
    except subprocess.CalledProcessError as exc:
        details = exc.stderr.strip() or exc.stdout.strip() or str(exc)
        raise RuntimeError(f"ELK layout failed: {details}") from exc

    try:
        response = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"ELK layout returned invalid JSON: {completed.stdout[:500]}") from exc

    positioned = {
        names_by_id[item["id"]]: item
        for item in response.get("nodes", [])
        if item.get("id") in names_by_id
    }
    if set(positioned) != set(names):
        missing = sorted(set(names) - set(positioned), key=str.casefold)
        raise RuntimeError(f"ELK layout omitted {len(missing)} nodes: {missing[:5]}")

    rows_by_y: Dict[float, List[str]] = defaultdict(list)
    for name, item in positioned.items():
        rows_by_y[round(float(item["y"]), 2)].append(name)
    y_to_rank = {y: index for index, y in enumerate(sorted(rows_by_y))}

    layout: Dict[str, Dict[str, object]] = {}
    for y, row in rows_by_y.items():
        ordered_row = sorted(row, key=lambda item: (float(positioned[item]["x"]), item.casefold()))
        for row_index, name in enumerate(ordered_row):
            base = dict(fallback_layout[name])
            base.update(
                {
                    "x": round(float(positioned[name]["x"]), 2),
                    "y": round(float(positioned[name]["y"]), 2),
                    "rank": int(y_to_rank[y]),
                    "rowOrder": row_index,
                    "layoutEngine": "elk-layered",
                    "elkWidth": round(float(positioned[name].get("width", 0)), 2),
                    "elkHeight": round(float(positioned[name].get("height", 0)), 2),
                }
            )
            layout[name] = base

    _bottom_align_faculty_components(layout, people, edge_list)
    _center_layout(layout)
    _refresh_rank_and_order(layout)
    _enforce_row_spacing(layout, min_gap=178.0)
    _enforce_faculty_peer_adjacency(layout, people, edge_list)
    _center_layout(layout)
    _refresh_rank_and_order(layout)
    return layout


def _bottom_align_faculty_components(
    layout: Dict[str, Dict[str, object]],
    people: Dict[str, Dict[str, Optional[object]]],
    edges: Iterable[Tuple[str, str]],
) -> None:
    faculty = [name for name in layout if people[name].get("cmu", False)]
    if not faculty:
        return

    bottom_y = max(float(layout[name]["y"]) for name in faculty)
    graph = nx.Graph()
    graph.add_nodes_from(layout)
    graph.add_edges_from((advisor, advisee) for advisor, advisee in edges if advisor in layout and advisee in layout)

    for component in nx.connected_components(graph):
        component_faculty = [name for name in component if people[name].get("cmu", False)]
        if not component_faculty:
            continue
        component_bottom = max(float(layout[name]["y"]) for name in component_faculty)
        shift_y = bottom_y - component_bottom
        for name in component:
            layout[name]["y"] = round(float(layout[name]["y"]) + shift_y, 2)
        for name in component_faculty:
            layout[name]["y"] = round(bottom_y, 2)


def _center_layout(layout: Dict[str, Dict[str, object]]) -> None:
    if not layout:
        return
    min_x = min(float(item["x"]) - float(item.get("elkWidth", 0)) / 2 for item in layout.values())
    max_x = max(float(item["x"]) + float(item.get("elkWidth", 0)) / 2 for item in layout.values())
    min_y = min(float(item["y"]) - float(item.get("elkHeight", 0)) / 2 for item in layout.values())
    max_y = max(float(item["y"]) + float(item.get("elkHeight", 0)) / 2 for item in layout.values())
    center_x = (min_x + max_x) / 2
    center_y = (min_y + max_y) / 2
    for item in layout.values():
        item["x"] = round(float(item["x"]) - center_x, 2)
        item["y"] = round(float(item["y"]) - center_y, 2)


def _refresh_rank_and_order(layout: Dict[str, Dict[str, object]]) -> None:
    rows: Dict[float, List[str]] = defaultdict(list)
    for name, position in layout.items():
        rows[round(float(position["y"]), 2)].append(name)
    for rank, y in enumerate(sorted(rows)):
        ordered = sorted(rows[y], key=lambda name: (float(layout[name]["x"]), name.casefold()))
        for row_index, name in enumerate(ordered):
            layout[name]["rank"] = rank
            layout[name]["rowOrder"] = row_index


def _enforce_row_spacing(layout: Dict[str, Dict[str, object]], min_gap: float) -> None:
    rows: Dict[float, List[str]] = defaultdict(list)
    for name, position in layout.items():
        rows[round(float(position["y"]), 2)].append(name)

    for row in rows.values():
        if len(row) < 2:
            continue
        target_x = {name: float(layout[name]["x"]) for name in row}
        resolved = _resolve_layer_positions(row, target_x, min_gap)
        ordered = sorted(row, key=lambda name: (resolved[name], name.casefold()))
        for index, name in enumerate(ordered):
            layout[name]["x"] = round(resolved[name], 2)
            layout[name]["rowOrder"] = index


def _enforce_faculty_peer_adjacency(
    layout: Dict[str, Dict[str, object]],
    people: Dict[str, Dict[str, Optional[object]]],
    edges: Iterable[Tuple[str, str]],
) -> None:
    faculty = [name for name in layout if people[name].get("cmu", False)]
    if len(faculty) < 2:
        return

    faculty_set = set(faculty)
    edge_list = list(edges)
    advisor_targets: Dict[str, List[float]] = {name: [] for name in faculty}
    for advisor, advisee in edge_list:
        if advisee in advisor_targets and advisor in layout and advisor not in faculty_set:
            advisor_targets[advisee].append(float(layout[advisor]["x"]))

    def faculty_target_x(name: str) -> Tuple[float, float, str]:
        targets = advisor_targets.get(name, [])
        barycenter = sum(targets) / len(targets) if targets else float(layout[name]["x"])
        return barycenter, float(layout[name]["x"]), name.casefold()

    current_order = sorted(faculty, key=faculty_target_x)
    ordered_faculty = _faculty_peer_adjacent_order(current_order, edge_list)

    x_slots = sorted(float(layout[name]["x"]) for name in faculty)
    bottom_y = max(float(layout[name]["y"]) for name in faculty)
    for index, name in enumerate(ordered_faculty):
        layout[name]["x"] = round(x_slots[index], 2)
        layout[name]["y"] = round(bottom_y, 2)
        layout[name]["rowOrder"] = index
        layout[name]["facultySink"] = True
        layout[name]["facultyPerimeter"] = True


def build_layout(
    people: Dict[str, Dict[str, Optional[object]]],
    edges: Iterable[Tuple[str, str]],
    layout_engine: str = "elk",
) -> Dict[str, Dict[str, object]]:
    fallback_layout = _build_anchor_layout(people, edges)
    if layout_engine == "anchor":
        return fallback_layout
    if layout_engine != "elk":
        raise ValueError(f"Unsupported layout engine: {layout_engine}")
    return _build_elk_layout(people, edges, fallback_layout)


def infer_chronology_years(
    people: Dict[str, Dict[str, Optional[object]]],
    edges: Iterable[Tuple[str, str]],
    unknown_offset: int = 5,
) -> Dict[str, Optional[float]]:
    """Infer hidden years for chronological positioning."""
    names = sorted(people, key=str.casefold)
    incoming, outgoing = _relation_maps(names, edges)

    def normalize_hidden_year(value: float) -> float:
        rounded = round(value, 2)
        return int(rounded) if rounded.is_integer() else rounded

    known_years = {
        name: year
        for name in names
        for year in [_known_year(people.get(name, {}))]
        if year is not None
    }

    link_gaps = [
        advisee_year - advisor_year
        for advisor, advisee in edges
        for advisor_year in [_known_year(people.get(advisor, {}))]
        for advisee_year in [_known_year(people.get(advisee, {}))]
        if advisor_year is not None and advisee_year is not None and advisee_year > advisor_year
    ]
    average_link_gap = sum(link_gaps) / len(link_gaps) if link_gaps else float(unknown_offset)

    def nearest_anchors(start: str, relations: Dict[str, List[str]]) -> List[Tuple[int, int]]:
        anchors: List[Tuple[int, int]] = []
        queue: deque[Tuple[str, int]] = deque([(start, 0)])
        seen: Set[str] = {start}
        nearest_distance: Optional[int] = None

        while queue:
            name, distance = queue.popleft()
            if nearest_distance is not None and distance >= nearest_distance:
                continue
            for linked in relations.get(name, []):
                if linked in seen:
                    continue
                seen.add(linked)
                linked_distance = distance + 1
                year = known_years.get(linked)
                if year is not None:
                    if nearest_distance is None or linked_distance < nearest_distance:
                        anchors = []
                        nearest_distance = linked_distance
                    if linked_distance == nearest_distance:
                        anchors.append((year, linked_distance))
                    continue
                if nearest_distance is None or linked_distance < nearest_distance:
                    queue.append((linked, linked_distance))
        return anchors

    chronology: Dict[str, Optional[float]] = {}
    for name in names:
        known = known_years.get(name)
        if known is not None:
            chronology[name] = known
            continue

        upstream = nearest_anchors(name, incoming)
        downstream = nearest_anchors(name, outgoing)
        candidates: List[float] = []

        if upstream and downstream:
            for upstream_year, upstream_distance in upstream:
                for downstream_year, downstream_distance in downstream:
                    total_distance = upstream_distance + downstream_distance
                    if total_distance <= 0:
                        continue
                    candidates.append(
                        upstream_year
                        + (downstream_year - upstream_year) * upstream_distance / total_distance
                    )
        elif upstream:
            candidates = [
                upstream_year + upstream_distance * average_link_gap
                for upstream_year, upstream_distance in upstream
            ]
        elif downstream:
            candidates = [
                downstream_year - downstream_distance * average_link_gap
                for downstream_year, downstream_distance in downstream
            ]

        chronology[name] = (
            normalize_hidden_year(sum(candidates) / len(candidates))
            if candidates
            else None
        )

    return chronology


def build_graph_data(
    people: Dict[str, Dict[str, Optional[object]]],
    edges: Iterable[Tuple[str, str]],
    explicit_none: Set[str],
    explicit_ill: Set[str],
    skipped_rows: int = 0,
    layout_engine: str = "elk",
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
    layout_by_name = build_layout(renderable_people, renderable_edges, layout_engine=layout_engine)
    chronology_years = infer_chronology_years(renderable_people, renderable_edges)

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
        university = clean_optional_text(attrs.get("university"))
        university_label = primary_university(university)
        country_label = country_label_from_sheet(attrs.get("country"))
        continent_label = continent_label_from_sheet(attrs.get("continent"))
        chronology_year = chronology_years.get(name)
        nodes.append(
            {
                "id": ids_by_name[name],
                "name": name,
                "year": year if isinstance(year, int) and year >= 0 else None,
                "yearLabel": year_label,
                "chronologyYear": chronology_year,
                "title": attrs.get("title"),
                "university": university,
                "universityLabel": university_label,
                "countryLabel": country_label,
                "continentLabel": continent_label,
                "role": role,
                "era": era,
                "sources": attrs.get("sources") if isinstance(attrs.get("sources"), list) else [],
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
        faculty_peer = bool(
            renderable_people[advisor].get("cmu", False)
            and renderable_people[advisee].get("cmu", False)
        )
        json_edges.append(
            {
                "id": f"e{idx}-{ids_by_name[advisor]}-{ids_by_name[advisee]}",
                "source": ids_by_name[advisor],
                "target": ids_by_name[advisee],
                "advisorName": advisor,
                "adviseeName": advisee,
                "type": "advisor",
                "facultyPeer": faculty_peer,
                "orientation": "same-level" if faculty_peer else "top-to-bottom",
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
                "name": "advisor-elk-layered" if layout_engine == "elk" else "advisor-layered-tree",
                "rankDirection": "top-to-bottom",
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


def read_family_tree_csv(csv_path: str) -> pd.DataFrame:
    """Read a family-tree CSV and normalize its column names."""
    df = pd.read_csv(csv_path, keep_default_na=False)
    df.columns = [norm(c) for c in df.columns]
    return df


def append_supplemental_rows(df: pd.DataFrame, supplemental_csvs: Iterable[str]) -> pd.DataFrame:
    """Append optional supplemental rows to the primary source dataframe."""
    frames = [df]
    for supplemental_csv in supplemental_csvs:
        path = Path(supplemental_csv)
        if not path.exists():
            raise FileNotFoundError(f"Supplemental CSV not found: {path}")
        frames.append(read_family_tree_csv(str(path)))
    if len(frames) == 1:
        return df
    return pd.concat(frames, ignore_index=True, sort=False)


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
    parser.add_argument(
        "--supplemental-csv",
        dest="supplemental_csvs",
        action="append",
        default=[],
        help="Optional CSV rows to append after the primary CSV. May be supplied more than once.",
    )
    parser.add_argument(
        "--layout-engine",
        choices=["elk", "anchor"],
        default="elk",
        help="Layout engine for generated node coordinates.",
    )
    args = parser.parse_args(argv)

    df = read_family_tree_csv(args.csv_path)
    df = append_supplemental_rows(df, args.supplemental_csvs)

    required_cols = {"generation", "advisee", "advisor", "title", "year"}
    missing = required_cols - set(df.columns)
    if missing:
        raise ValueError(f"Missing required columns: {missing}. Found columns: {list(df.columns)}")

    people, edges, explicit_none, explicit_ill, skipped_rows = build_graph(df)
    if skipped_rows:
        print(f"Skipped {skipped_rows} rows because advisee values were missing/placeholder.")

    impute_years(people, placeholder=-1)
    graph_data = build_graph_data(
        people,
        edges,
        explicit_none,
        explicit_ill,
        skipped_rows,
        layout_engine=args.layout_engine,
    )

    output_json = args.output_json
    if output_json is None:
        output_json = f"{args.output_basename or 'family_tree'}.json"
    write_graph_data(graph_data, output_json)


if __name__ == "__main__":  # pragma: no cover
    main()
