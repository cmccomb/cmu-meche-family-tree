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
the exported data preserves a stable advisor-sensitive layered tree layout.
"""

from __future__ import annotations

import argparse
from collections import defaultdict, deque
import hashlib
import json
import math
import re
import unicodedata
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

COUNTRY_ALIASES = {
    "america": "United States",
    "england": "United Kingdom",
    "great britain": "United Kingdom",
    "the netherlands": "Netherlands",
    "uk": "United Kingdom",
    "u.k.": "United Kingdom",
    "united states": "United States",
    "united states of america": "United States",
    "us": "United States",
    "u.s.": "United States",
    "usa": "United States",
    "u.s.a.": "United States",
}

COUNTRY_NAMES = {
    "Australia",
    "Austria",
    "Belgium",
    "Canada",
    "China",
    "Denmark",
    "France",
    "Germany",
    "India",
    "Israel",
    "Italy",
    "Japan",
    "Netherlands",
    "Norway",
    "Russia",
    "Spain",
    "Sweden",
    "Switzerland",
    "United Kingdom",
    "United States",
}

CONTINENT_BY_COUNTRY = {
    "Australia": "Oceania",
    "Austria": "Europe",
    "Belgium": "Europe",
    "Canada": "North America",
    "China": "Asia",
    "Denmark": "Europe",
    "France": "Europe",
    "Germany": "Europe",
    "India": "Asia",
    "Israel": "Asia",
    "Italy": "Europe",
    "Japan": "Asia",
    "Netherlands": "Europe",
    "Norway": "Europe",
    "Russia": "Europe",
    "Spain": "Europe",
    "Sweden": "Europe",
    "Switzerland": "Europe",
    "United Kingdom": "Europe",
    "United States": "North America",
}

COUNTRY_PATTERNS: List[Tuple[str, str]] = [
    (
        r"\b(mit|harvard|yale|stanford|carnegie mellon|uc berkeley|berkeley|"
        r"university of michig|uiuc|illinois|brown|cornell|johns hopkins|"
        r"princeton|northwestern|university of pennsylvania|georgia tech|"
        r"ut austin|university of texas|university of minnesota|"
        r"university of wisconsin|university of delaware|arizona state|"
        r"university of virginia|cu boulder|case western|purdue|caltech|"
        r"columbia|university of chicago)\b",
        "United States",
    ),
    (r"\b(louvain|leuven|liege|ghent|gent|universite catholique de louvain)\b", "Belgium"),
    (r"\b(basel|zurich|geneve|lausanne|epfl|eth)\b", "Switzerland"),
    (r"\b(wien|vienna|graz|innsbruck)\b", "Austria"),
    (r"\b(uppsala|lund|stockholm|kth)\b", "Sweden"),
    (r"\b(new brunswick|toronto|mcgill|waterloo|british columbia|alberta|mcmaster)\b", "Canada"),
    (
        r"\b(universitat|universitaet|leipzig|gottingen|goettingen|halle|"
        r"wittenberg|tubingen|tuebingen|jena|heidelberg|berlin|konigsberg|"
        r"koenigsberg|helmstedt|erlangen|karlsruhe|munich|muenchen|freiburg)\b",
        "Germany",
    ),
    (r"\b(cambridge|oxford|trinity college|imperial|ucl|edinburgh|manchester)\b", "United Kingdom"),
    (r"\b(universita|padova|padua|firenze|pisa|bologna|torino|roma|milan|milano)\b", "Italy"),
    (r"\b(universiteit|leiden|utrecht|delft|amsterdam|groningen)\b", "Netherlands"),
    (r"\b(universite|ecole|sorbonne|paris|orsay|montaigu|polytechnique)\b", "France"),
    (r"\b(tokyo|kyoto|osaka|tohoku|waseda|nagoya|technion)\b", "Japan"),
    (r"\b(peking|tsinghua|beijing|sjtu|shanghai jiao tong|hong kong)\b", "China"),
    (r"\b(moscow|st petersburg|saint petersburg)\b", "Russia"),
    (r"\b(copenhagen|aarhus)\b", "Denmark"),
    (r"\b(oslo|bergen)\b", "Norway"),
    (r"\b(madrid|barcelona)\b", "Spain"),
]


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


def _ascii_key(value: object) -> str:
    """Return an accent-insensitive matching key."""
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = re.sub(r"[^a-zA-Z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip().casefold()


def _canonical_country(value: object) -> Optional[str]:
    """Normalize explicit country text when it is a known country label."""
    text = clean_optional_text(value)
    if not text:
        return None
    key = _ascii_key(text).strip(".")
    if key in COUNTRY_ALIASES:
        return COUNTRY_ALIASES[key]
    for country in COUNTRY_NAMES:
        if key == _ascii_key(country):
            return country
    return None


def country_for_university(university: Optional[object], explicit_country: Optional[object] = None) -> str:
    """Infer a country label from explicit country data or university text."""
    country = _canonical_country(explicit_country)
    if country:
        return country

    university_label = primary_university(university)
    if university_label == "Unknown university":
        return "Unknown country"

    parts = [part.strip() for part in str(university_label).split(",") if part.strip()]
    if len(parts) > 1:
        country = _canonical_country(parts[-1])
        if country:
            return country

    key = _ascii_key(university_label)
    for pattern, country_label in COUNTRY_PATTERNS:
        if re.search(pattern, key):
            return country_label
    return "Unknown country"


def continent_for_country(country: Optional[object]) -> str:
    """Return a continent label for supported country values."""
    country_label = _canonical_country(country)
    if not country_label:
        return "Other"
    return CONTINENT_BY_COUNTRY.get(country_label, "Other")


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
        source_generation = to_int_or_none(r.get("generation", None))
        cmu = is_cmu_faculty_marker(r.get("generation", None))
        title = None if pd.isna(r.get("title", None)) else str(r.get("title", None)).strip()
        if title == "":
            title = None
        university = clean_optional_text(r.get("university", None))
        country = clean_optional_text(r.get("country", None))

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


def _faculty_left_to_right_order(
    ordered_faculty: List[str],
    edges: Iterable[Tuple[str, str]],
) -> List[str]:
    """Keep faculty advisor links left-to-right when faculty share a row."""
    faculty_set = set(ordered_faculty)
    graph = nx.DiGraph()
    graph.add_nodes_from(ordered_faculty)
    graph.add_edges_from(
        (advisor, advisee)
        for advisor, advisee in edges
        if advisor in faculty_set and advisee in faculty_set
    )
    if not nx.is_directed_acyclic_graph(graph):
        return ordered_faculty

    original_order = {name: index for index, name in enumerate(ordered_faculty)}
    return list(
        nx.lexicographical_topological_sort(
            graph,
            key=lambda name: (original_order.get(name, len(original_order)), name.casefold()),
        )
    )


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


def build_layout(
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
    ordered_faculty = _faculty_left_to_right_order(
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


def infer_chronology_years(
    people: Dict[str, Dict[str, Optional[object]]],
    edges: Iterable[Tuple[str, str]],
    unknown_offset: int = 5,
) -> Dict[str, Optional[int]]:
    """Infer display years for chronological vertical scaling."""
    names = sorted(people, key=str.casefold)
    _, outgoing = _relation_maps(names, edges)
    memo: Dict[str, Optional[int]] = {}

    def infer(name: str, visiting: Set[str]) -> Optional[int]:
        if name in memo:
            return memo[name]
        known = _known_year(people.get(name, {}))
        if known is not None:
            memo[name] = known
            return known
        if name in visiting:
            return None

        visiting.add(name)
        child_years = [
            child_year
            for child in outgoing.get(name, [])
            for child_year in [infer(child, visiting)]
            if child_year is not None
        ]
        visiting.remove(name)

        inferred = max(child_years) - unknown_offset if child_years else None
        memo[name] = inferred
        return inferred

    for name in names:
        infer(name, set())
    return memo


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
        country_label = country_for_university(university, attrs.get("country"))
        continent_label = continent_for_country(country_label)
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
                "orientation": "left-to-right" if faculty_peer else "top-to-bottom",
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
                "name": "advisor-layered-tree",
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
