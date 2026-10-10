"""Seed dokumen dev/E2E via API (idempoten; 409 = sudah ada, dilewati).

Dibutuhkan karena spec Playwright `T1 documents` memilih `aldo_pump_logs_2.csv`
yang tidak ada di repo — isinya di-seed dari fixture agar test mandiri.
Butuh backend hidup di BASE (default http://127.0.0.1:3031).

Pakai: backend/venv/bin/python scripts/seed_e2e_docs.py [--base URL]
"""

from __future__ import annotations

import sys
from pathlib import Path

import httpx

BASE = sys.argv[sys.argv.index("--base") + 1] if "--base" in sys.argv else "http://127.0.0.1:3031"
HERE = Path(__file__).resolve().parent
FIXTURES = HERE.parent / "frontend" / "e2e" / "fixtures"

SEEDS = {
    "aldo_pump_logs_2.csv": FIXTURES / "pw_upload_voltage.csv",
}


def main() -> int:
    ok = True
    for doc_id, src in SEEDS.items():
        content = src.read_bytes()
        r = httpx.post(f"{BASE}/documents/upload", params={"filename": doc_id},
                       content=content, timeout=60)
        if r.status_code == 201:
            print(f"seeded {doc_id} ({len(content)} bytes)")
        elif r.status_code == 409:
            print(f"exists {doc_id} (skip)")
        else:
            print(f"FAIL {doc_id}: {r.status_code} {r.text[:200]}")
            ok = False
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
