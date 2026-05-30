import pandas as pd

from make_graph import build_graph


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
