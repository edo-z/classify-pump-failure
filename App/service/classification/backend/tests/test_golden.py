"""Golden regression oracle for the classification engine.

Each case in ``tests/golden/`` is a frozen pair:

    <name>.input.json    -> POST /classify request body
    <name>.expected.json -> full Python response captured before refactor

These files are the behavioural contract for the Node.js migration. The test
is intentionally read-only: it never regenerates or updates expected output.
If behaviour changes, the fix belongs in the engine (or an explicit, reviewed
fixture regeneration via ``generate.py --write``).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

GOLDEN_DIR = Path(__file__).resolve().parent / "golden"


def _cases() -> list[tuple[str, Path, Path]]:
    cases = []
    for input_path in sorted(GOLDEN_DIR.glob("*.input.json")):
        name = input_path.name[: -len(".input.json")]
        expected_path = GOLDEN_DIR / f"{name}.expected.json"
        if not expected_path.exists():
            pytest.fail(f"missing expected fixture for {name}")
        cases.append((name, input_path, expected_path))
    return cases


CASES = _cases()


def test_golden_fixtures_exist() -> None:
    assert CASES, "no golden fixtures found in tests/golden"
    assert len(CASES) >= 20, f"expected at least 20 scenarios, got {len(CASES)}"


@pytest.mark.parametrize(
    ("name", "input_path", "expected_path"),
    CASES,
    ids=[case[0] for case in CASES],
)
def test_golden_case(name: str, input_path: Path, expected_path: Path) -> None:
    body = json.loads(input_path.read_text(encoding="utf-8"))
    expected = json.loads(expected_path.read_text(encoding="utf-8"))

    response = TestClient(app).post("/classify", json=body)

    assert response.status_code == 200, f"{name}: {response.text}"
    assert response.json() == expected, f"{name}: classification output changed"
