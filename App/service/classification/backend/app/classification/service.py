"""Factory/facade untuk Classification Engine.

5R Ringkas — satu pintu akses engine. Modul ini tidak bergantung pada
pipeline CSV, filesystem, atau MySQL; semua aturan tetap dijalankan
oleh `RulesEngine` (rules.json).

Padanan Node.js pada tahap migrasi: `engineFactory.js`.
"""

from __future__ import annotations

from app.classification.engine import (
    RULES_FILE,
    RulesEngine,
)

_engine: RulesEngine | None = None


def get_engine() -> RulesEngine:
    """Kembalikan instance RulesEngine tunggal (dibuat sekali, dipakai ulang)."""
    global _engine

    if _engine is None:
        _engine = RulesEngine(
            RULES_FILE
        )

    return _engine
