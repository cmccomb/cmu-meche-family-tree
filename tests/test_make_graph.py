import json

import pandas as pd

from make_graph import build_graph, build_graph_data, impute_years, is_cmu_faculty_marker, main


def test_placeholder_advisors_and_nan_filtering() -> None:
    df = pd.DataFrame(
        [
            {
                "generation": 1,
                "advisee": "Alice",
                "advisor": "",
                "title": "MS",
                "year": 2001,
            },
            {
                "generation": 1,
                "advisee": "Bob",
                "advisor": float("nan"),
                "title": "PhD",
                "year": 2002,
            },
            {
                "generation": 1,
                "advisee": "Cara",
                "advisor": "nan",
                "title": "PhD",
                "year": 2003,
            },
            {
                "generation": 1,
                "advisee": "Dan",
                "advisor": " NaN ",
                "title": "PhD",
                "year": 2004,
            },
            {
                "generation": 1,
                "advisee": "Eve",
                "advisor": "None",
                "title": "PhD",
                "year": 2005,
            },
            {
                "generation": 1,
                "advisee": "Frank",
                "advisor": "ILL Request",
                "title": "PhD",
                "year": 2006,
            },
            {
                "generation": 1,
                "advisee": "Grace",
                "advisor": "N/A; Henry ; - ; unknown ; nan",
                "title": "PhD",
                "year": 2007,
            },
            {
                "generation": 1,
                "advisee": "Ivan",
                "advisor": " NaN ; Henry ; unknown ; ILL Request ; None",
                "title": "PhD",
                "year": 2008,
            },
            {
                "generation": 1,
                "advisee": pd.NA,
                "advisor": "Henry",
                "title": "PhD",
                "year": 2009,
            },
            {
                "generation": 0,
                "advisee": "Henry",
                "advisor": "",
                "title": "Prof",
                "year": 1980,
            },
        ]
    )

    people, edges, explicit_none, explicit_ill, skipped_rows = build_graph(df)

    assert skipped_rows == 1
    assert "nan" not in {name.lower() for name in people}

    placeholder_tokens = {"none", "n/a", "na", "nan", "null", "unknown", "-"}
    assert all(u.casefold() not in placeholder_tokens and v.casefold() not in placeholder_tokens for u, v in edges)

    assert "Eve" in explicit_none
    assert "Frank" in explicit_ill
    assert "Ivan" in explicit_none
    assert "Ivan" in explicit_ill
    assert ("Henry", "Ivan") in edges


def test_generation_marker_treats_blank_as_nonfaculty() -> None:
    assert is_cmu_faculty_marker(0)
    assert is_cmu_faculty_marker("0")
    assert is_cmu_faculty_marker(False)
    assert not is_cmu_faculty_marker("")
    assert not is_cmu_faculty_marker(1)
    assert not is_cmu_faculty_marker("true")


def test_reciprocal_advisor_edges_keep_older_to_newer_direction() -> None:
    df = pd.DataFrame(
        [
            {
                "generation": "",
                "advisee": "Older Mentor",
                "advisor": "Newer Scholar",
                "title": "PhD",
                "year": 1970,
            },
            {
                "generation": "",
                "advisee": "Newer Scholar",
                "advisor": "Older Mentor",
                "title": "PhD",
                "year": 1990,
            },
        ]
    )

    _, edges, _, _, _ = build_graph(df)

    assert ("Older Mentor", "Newer Scholar") in edges
    assert ("Newer Scholar", "Older Mentor") not in edges


def test_build_graph_data_exports_browser_payload() -> None:
    df = pd.DataFrame(
        [
            {
                "generation": "",
                "advisee": "Root Mentor",
                "advisor": "",
                "title": "PhD",
                "university": "Example University",
                "year": 1970,
            },
            {
                "generation": 0,
                "advisee": "Prof Advisor",
                "advisor": "Root Mentor",
                "title": "Professor",
                "university": "Carnegie Mellon University",
                "country": "",
                "year": 1999,
            },
            {
                "generation": 1,
                "advisee": "Student One",
                "advisor": "Root Mentor",
                "title": "PhD",
                "university": "Example University",
                "country": "Canada",
                "year": 2024,
            },
            {
                "generation": "",
                "advisee": "Student Two",
                "advisor": "Root Mentor; ILL Request",
                "title": "MS",
                "university": "",
                "country": "",
                "year": 2025,
            },
        ]
    )

    people, edges, explicit_none, explicit_ill, skipped_rows = build_graph(df)
    impute_years(people)
    payload = build_graph_data(people, edges, explicit_none, explicit_ill, skipped_rows)

    assert payload["meta"]["nodeCount"] == 4
    assert payload["meta"]["edgeCount"] == 3
    assert payload["meta"]["facultyCount"] == 1
    assert payload["filters"]["eras"] == ["Before 1980", "1980-1999", "2020-present"]

    people_by_name = {node["name"]: node for node in payload["nodes"]}
    assert people_by_name["Prof Advisor"]["category"] == "cmu-faculty"
    assert people_by_name["Student One"]["role"] == "PhD alumni"
    assert people_by_name["Student Two"]["role"] == "MS alumni"
    assert people_by_name["Student Two"]["category"] == "follow-up"
    assert people_by_name["Prof Advisor"]["universityLabel"] == "Carnegie Mellon University"
    assert people_by_name["Student One"]["universityLabel"] == "Example University"
    assert people_by_name["Student Two"]["universityLabel"] == "Unknown university"
    assert people_by_name["Prof Advisor"]["countryLabel"] == "United States"
    assert people_by_name["Student One"]["countryLabel"] == "Canada"
    assert people_by_name["Student Two"]["countryLabel"] == "Unknown country"
    assert people_by_name["Prof Advisor"]["continentLabel"] == "North America"
    assert people_by_name["Student One"]["continentLabel"] == "North America"
    assert people_by_name["Student Two"]["continentLabel"] == "Unknown / none"
    assert people_by_name["Prof Advisor"]["chronologyYear"] == 1999
    assert people_by_name["Prof Advisor"]["layout"]["facultySink"] is True
    assert people_by_name["Prof Advisor"]["layout"]["facultyPerimeter"] is True
    assert payload["meta"]["layout"]["name"] == "advisor-layered-tree"
    assert payload["meta"]["layout"]["rankDirection"] == "top-to-bottom"
    assert payload["meta"]["layout"]["facultySink"] is True
    assert people_by_name["Root Mentor"]["layout"]["y"] < people_by_name["Prof Advisor"]["layout"]["y"]
    assert people_by_name["Root Mentor"]["layout"]["y"] < people_by_name["Student One"]["layout"]["y"]

    edge_by_pair = {(edge["advisorName"], edge["adviseeName"]): edge for edge in payload["edges"]}
    edge = edge_by_pair[("Root Mentor", "Prof Advisor")]
    assert edge["source"] == people_by_name["Root Mentor"]["id"]
    assert edge["target"] == people_by_name["Prof Advisor"]["id"]
    assert edge["facultyPeer"] is False
    assert edge["orientation"] == "top-to-bottom"


def test_layout_places_lineages_on_layered_tree_rows() -> None:
    df = pd.DataFrame(
        [
            {
                "generation": "",
                "advisee": "Root Mentor",
                "advisor": "",
                "title": "PhD",
                "university": "",
                "year": 1950,
            },
            {
                "generation": "",
                "advisee": "Advisor Alpha",
                "advisor": "Root Mentor",
                "title": "PhD",
                "university": "",
                "year": 1975,
            },
            {
                "generation": "",
                "advisee": "Advisor Gamma",
                "advisor": "Root Mentor",
                "title": "PhD",
                "university": "",
                "year": 1980,
            },
            {
                "generation": 0,
                "advisee": "Faculty Beta",
                "advisor": "Advisor Alpha",
                "title": "Professor",
                "university": "CMU",
                "year": 2005,
            },
            {
                "generation": 0,
                "advisee": "Faculty Delta",
                "advisor": "Advisor Gamma",
                "title": "Professor",
                "university": "CMU",
                "year": 2010,
            },
            {
                "generation": "",
                "advisee": "Disconnected Old",
                "advisor": "",
                "title": "PhD",
                "university": "",
                "year": 1960,
            },
            {
                "generation": "",
                "advisee": "Disconnected New",
                "advisor": "",
                "title": "PhD",
                "university": "",
                "year": 2020,
            },
        ]
    )

    people, edges, explicit_none, explicit_ill, skipped_rows = build_graph(df)
    impute_years(people)
    payload = build_graph_data(people, edges, explicit_none, explicit_ill, skipped_rows)
    people_by_name = {node["name"]: node for node in payload["nodes"]}

    beta = people_by_name["Faculty Beta"]["layout"]
    delta = people_by_name["Faculty Delta"]["layout"]
    alpha = people_by_name["Advisor Alpha"]["layout"]
    gamma = people_by_name["Advisor Gamma"]["layout"]
    root = people_by_name["Root Mentor"]["layout"]

    assert beta["facultySink"] is True
    assert delta["facultySink"] is True
    assert beta["facultyPerimeter"] is True
    assert delta["facultyPerimeter"] is True
    assert alpha["y"] < beta["y"]
    assert gamma["y"] < delta["y"]
    assert root["y"] < alpha["y"]
    assert root["y"] < gamma["y"]
    assert abs(alpha["x"] - beta["x"]) < abs(alpha["x"] - delta["x"])
    assert abs(gamma["x"] - delta["x"]) < abs(gamma["x"] - beta["x"])
    assert min(beta["x"], delta["x"]) <= root["x"] <= max(beta["x"], delta["x"])
    assert abs(people_by_name["Disconnected Old"]["layout"]["x"] - people_by_name["Disconnected New"]["layout"]["x"]) >= 178
    assert people_by_name["Root Mentor"]["chronologyYear"] == 1950
    for edge in payload["edges"]:
        advisor = people_by_name[edge["advisorName"]]["layout"]
        advisee = people_by_name[edge["adviseeName"]]["layout"]
        if edge["facultyPeer"]:
            assert advisor["y"] == advisee["y"]
            assert advisor["x"] < advisee["x"]
            assert edge["orientation"] == "left-to-right"
        else:
            assert advisor["y"] < advisee["y"]
    assert payload["meta"]["layout"]["name"] == "advisor-layered-tree"


def test_faculty_advising_faculty_share_bottom_row_left_to_right() -> None:
    df = pd.DataFrame(
        [
            {
                "generation": "",
                "advisee": "Root Mentor",
                "advisor": "",
                "title": "PhD",
                "year": 1970,
            },
            {
                "generation": 0,
                "advisee": "Faculty Advisor",
                "advisor": "Root Mentor",
                "title": "Professor",
                "year": 2000,
            },
            {
                "generation": 0,
                "advisee": "Faculty Advisee",
                "advisor": "Faculty Advisor",
                "title": "Professor",
                "year": 2010,
            },
        ]
    )

    people, edges, explicit_none, explicit_ill, skipped_rows = build_graph(df)
    impute_years(people)
    payload = build_graph_data(people, edges, explicit_none, explicit_ill, skipped_rows)
    people_by_name = {node["name"]: node for node in payload["nodes"]}
    edge_by_pair = {(edge["advisorName"], edge["adviseeName"]): edge for edge in payload["edges"]}

    root = people_by_name["Root Mentor"]["layout"]
    faculty_advisor = people_by_name["Faculty Advisor"]["layout"]
    faculty_advisee = people_by_name["Faculty Advisee"]["layout"]
    faculty_edge = edge_by_pair[("Faculty Advisor", "Faculty Advisee")]

    assert faculty_advisor["facultySink"] is True
    assert faculty_advisee["facultySink"] is True
    assert faculty_advisor["y"] == faculty_advisee["y"]
    assert root["y"] < faculty_advisor["y"]
    assert faculty_advisor["x"] < faculty_advisee["x"]
    assert faculty_edge["facultyPeer"] is True
    assert faculty_edge["orientation"] == "left-to-right"


def test_unknown_chronology_year_uses_recent_advisee() -> None:
    df = pd.DataFrame(
        [
            {
                "generation": 0,
                "advisee": "Recent Student",
                "advisor": "Unknown Mentor",
                "title": "PhD",
                "year": 2020,
            },
            {
                "generation": 0,
                "advisee": "Older Student",
                "advisor": "Unknown Mentor",
                "title": "PhD",
                "year": 2000,
            },
        ]
    )

    people, edges, explicit_none, explicit_ill, skipped_rows = build_graph(df)
    impute_years(people)
    payload = build_graph_data(people, edges, explicit_none, explicit_ill, skipped_rows)
    people_by_name = {node["name"]: node for node in payload["nodes"]}

    assert people_by_name["Unknown Mentor"]["year"] is None
    assert people_by_name["Unknown Mentor"]["chronologyYear"] == 2015


def test_cli_preserves_literal_none_advisor_token(tmp_path) -> None:
    csv_path = tmp_path / "tree.csv"
    json_path = tmp_path / "graph-data.json"
    csv_path.write_text(
        "\n".join(
            [
                "generation,advisee,advisor,title,year",
                "1,Unknown Branch,None,PhD,2020",
            ]
        ),
        encoding="utf-8",
    )

    main(["--csv", str(csv_path), "--output-json", str(json_path)])
    payload = json.loads(json_path.read_text(encoding="utf-8"))

    assert payload["meta"]["missingAdvisorCount"] == 1
    assert payload["nodes"][0]["category"] == "missing-advisor"


def test_cli_appends_supplemental_csv_rows(tmp_path) -> None:
    csv_path = tmp_path / "tree.csv"
    supplemental_path = tmp_path / "supplemental.csv"
    json_path = tmp_path / "graph-data.json"
    csv_path.write_text(
        "\n".join(
            [
                "generation,advisee,advisor,title,university,country,year",
                "1,Base Student,Base Advisor,PhD,Example University,Canada,2020",
            ]
        ),
        encoding="utf-8",
    )
    supplemental_path.write_text(
        "\n".join(
            [
                "generation,advisee,advisor,title,university,country,year",
                ",Supplemental Student,Supplemental Advisor,Doctor of Laws,University of Frankfurt (Oder),Germany,1665",
            ]
        ),
        encoding="utf-8",
    )

    main(
        [
            "--csv",
            str(csv_path),
            "--supplemental-csv",
            str(supplemental_path),
            "--output-json",
            str(json_path),
        ]
    )
    payload = json.loads(json_path.read_text(encoding="utf-8"))

    people_by_name = {node["name"]: node for node in payload["nodes"]}
    edge_by_pair = {(edge["advisorName"], edge["adviseeName"]) for edge in payload["edges"]}

    assert "Base Student" in people_by_name
    assert people_by_name["Supplemental Student"]["universityLabel"] == "University of Frankfurt (Oder)"
    assert people_by_name["Supplemental Student"]["countryLabel"] == "Germany"
    assert ("Supplemental Advisor", "Supplemental Student") in edge_by_pair
