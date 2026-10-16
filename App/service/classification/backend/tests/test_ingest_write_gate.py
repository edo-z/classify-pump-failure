"""Gate tulis worker: izin eksplisit + allowlist database target."""

import pytest

from app.ingest_db import db as db_mod


class _Cursor:
    def __init__(self, db_name):
        self.db_name = db_name

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, args=None):
        return 1

    def fetchone(self):
        return {"db": self.db_name}


class _Conn:
    def __init__(self, db_name):
        self.db_name = db_name

    def cursor(self):
        return _Cursor(self.db_name)


def test_write_refused_by_default():
    conn = _Conn("dexmin")
    with pytest.raises(db_mod.WriteNotAllowedError):
        db_mod.require_write_allowed(conn, "insert raw_classifications")


def test_write_refused_outside_allowlist(monkeypatch):
    monkeypatch.setenv("CLASSIFICATION_WRITE_ENABLED", "true")
    monkeypatch.setenv("CLASSIFICATION_WRITE_TARGET", "dexmin")
    conn = _Conn("production_lain")
    with pytest.raises(db_mod.WriteNotAllowedError):
        db_mod.require_write_allowed(conn, "insert raw_classifications")


def test_write_allowed_inside_allowlist(monkeypatch):
    monkeypatch.setenv("CLASSIFICATION_WRITE_ENABLED", "true")
    monkeypatch.setenv("CLASSIFICATION_WRITE_TARGET", "dexmin,dryrun_5r")
    conn = _Conn("dexmin")
    assert db_mod.require_write_allowed(conn, "insert") == "dexmin"


def test_poll_once_write_path_requires_gate():
    # Tanpa WRITE_ENABLED, jalur tulis (dry_run=False) wajib menolak
    # SEBELUM executemany — walau baris sudah terbentuk.
    import os

    os.environ.pop("CLASSIFICATION_WRITE_ENABLED", None)
    from app.ingest_db.worker import Worker
    from tests.test_ingest_dry_run import WritableFakeConn

    worker = Worker(interval_seconds=5.0)
    conn = WritableFakeConn()
    # Gate menolak karena WRITE_ENABLED tak diset — SEBELUM executemany.
    with pytest.raises(db_mod.WriteNotAllowedError):
        worker.poll_once(conn, dry_run=False)
    assert conn.written_rows == [] and conn.committed == 0
