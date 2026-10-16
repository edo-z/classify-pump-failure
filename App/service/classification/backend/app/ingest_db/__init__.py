"""DB ingest worker — jalur masuk klasifikasi via MySQL (Tahap 2, ingest-only).

Jalankan sebagai `python -m app.ingest_db.worker [--once] [--dry-run]`.
(__init__ sengaja minimal agar tidak double-import saat -m.)
"""

__all__ = ["Worker", "run_once"]


def __getattr__(name: str):
    if name in __all__:
        from app.ingest_db import worker as _worker

        return getattr(_worker, name)
    raise AttributeError(name)
