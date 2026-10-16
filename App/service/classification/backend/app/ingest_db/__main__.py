"""Entrypoint worker: python -m app.ingest_db.worker [--once] [--dry-run].

--dry-run (disarankan digabung --once untuk validasi read-only):
  SELECT + klasifikasi + bangun baris dijalankan, tetapi tanpa
  INSERT/UPDATE/DELETE dan tanpa COMMIT (rollback pengaman).
  Proteksi utama tetap user DB hak SELECT saja.
"""

from __future__ import annotations

import logging
import sys

logging.basicConfig(level=logging.INFO)


def main(argv: list[str]) -> int:
    from app.ingest_db.worker import run_once, run_forever

    if "--once" in argv:
        stats = run_once(dry_run="--dry-run" in argv)
        print(stats)
        return 0
    run_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
