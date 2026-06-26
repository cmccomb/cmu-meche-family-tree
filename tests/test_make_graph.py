import pandas as pd

import json

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


def test_build_graph_data_exports_browser_payload() -> None:
    df = pd.DataFrame(
        [
            {
                "generation": 0,
                "advisee": "Prof Advisor",
                "advisor": "",
                "title": "Professor",
                "year": 1999,
            },
            {
                "generation": 1,
                "advisee": "Student One",
                "advisor": "Prof Advisor",
                "title": "PhD",
                "year": 2024,
            },
            {
                "generation": "",
                "advisee": "Student Two",
                "advisor": "Prof Advisor; ILL Request",
                "title": "MS",
                "year": 2025,
            },
        ]
    )

    people, edges, explicit_none, explicit_ill, skipped_rows = build_graph(df)
    impute_years(people)
    payload = build_graph_data(people, edges, explicit_none, explicit_ill, skipped_rows)

    assert payload["meta"]["nodeCount"] == 3
    assert payload["meta"]["edgeCount"] == 2
    assert payload["meta"]["facultyCount"] == 1
    assert payload["filters"]["eras"] == ["1980-1999", "2020-present"]

    people_by_name = {node["name"]: node for node in payload["nodes"]}
    assert people_by_name["Prof Advisor"]["category"] == "cmu-faculty"
    assert people_by_name["Student One"]["role"] == "PhD alumni"
    assert people_by_name["Student Two"]["role"] == "MS alumni"
    assert people_by_name["Student Two"]["category"] == "follow-up"

    edge = payload["edges"][0]
    assert edge["source"] == people_by_name["Prof Advisor"]["id"]
    assert edge["target"] == people_by_name["Student One"]["id"]


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
