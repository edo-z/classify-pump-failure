"""Kontrak --dry-run (validasi read-only production).

  SELECT              -> DIIZINKAN (fake melayani 2 SELECT worker)
  klasifikasi         -> DIJALANKAN (engine asli)
  bangun 9 raw rows   -> DIJALANKAN (dihitung + dilaporkan)
  INSERT/UPDATE/DELETE/executemany-tulis/COMMIT -> DILARANG (raise)
  ROLLBACK            -> pengaman tambahan, dicatat

Proteksi utama tetap user DB hak SELECT saja; test ini mengunci
lapis aplikasi. Jalur tulis normal (dry_run=False) tetap diuji
menulis 9 baris + commit.
"""

from datetime import datetime, timezone

from app.ingest_db.worker import Worker


class WriteBlocked(AssertionError):
    pass


class FakeCursor:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, args=None):
        head = str(sql).strip().split(None, 1)[0].lower()
        self.conn.statements.append(head)
        lowered = str(sql).lower()
        if "select database()" in lowered:
            self._rows = [{"db": "dryrun_5r"}]
        elif "from pumps" in lowered:
            now = datetime.now(timezone.utc)
            pairs = [
                ("output_frequency", "38.0"),
                ("output_power", "300.0"),
                ("motor_current", "300.0"),
                ("motor_torque", "60.0"),
            ]
            self._rows = [
                {
                    "pump_id": 12,
                    "flowhead_type": "3000_lps",
                    "flowhead_power_kw": None,
                    "flowhead_current_a": None,
                    "param_key": key,
                    "rt_id": i,
                    "param_value": value,
                    "param_updated_at": now,
                }
                for i, (key, value) in enumerate(pairs)
            ]
        elif "pump_classification_config" in lowered:
            self._rows = []
        else:
            raise AssertionError(f"unexpected SQL in dry-run test: {sql!r}")
        return 1

    def executemany(self, sql, rows):
        raise WriteBlocked(f"executemany forbidden in dry-run: {sql!r}")

    def fetchall(self):
        return self._rows

    def fetchone(self):
        rows = self.fetchall()
        return rows[0] if rows else None


class FakeConn:
    def __init__(self, allow_writes=False):
        self.allow_writes = allow_writes
        self.statements = []
        self.written_rows = []
        self.committed = 0
        self.rolled_back = 0

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        if not self.allow_writes:
            raise WriteBlocked("commit forbidden in dry-run")
        self.committed += 1

    def rollback(self):
        self.rolled_back += 1


class WritableFakeCursor(FakeCursor):
    def executemany(self, sql, rows):
        self.conn.written_rows.extend(rows)
        return len(rows)


class WritableFakeConn(FakeConn):
    def __init__(self):
        super().__init__(allow_writes=True)

    def cursor(self):
        return WritableFakeCursor(self)


def test_dry_run_selects_and_classifies_without_writing():
    worker = Worker(interval_seconds=5.0)
    conn = FakeConn()
    stats = worker.poll_once(conn, dry_run=True)
    assert stats["dry_run"] is True
    assert stats["pumps_seen"] == 1
    assert stats["pumps_evaluated"] == 1
    assert stats["rows_would_write"] == 9
    assert stats["rows_written"] == 0
    assert stats["skipped"] == []
    assert stats["sample_effective_config"]["provenance"]["profile_id"] == "3000_lps"
    assert conn.rolled_back >= 1  # pengaman ganda terpanggil
    assert conn.committed == 0
    # Hanya SELECT yang boleh lewat (kepala statement, bukan substring
    # seperti "updated_at").
    assert set(conn.statements) <= {"select"}
    assert all(s == "select" for s in conn.statements)


def test_normal_write_path_still_writes_and_commits(monkeypatch):
    monkeypatch.setenv("CLASSIFICATION_WRITE_ENABLED", "true")
    monkeypatch.setenv("CLASSIFICATION_WRITE_TARGET", "dryrun_5r")
    worker = Worker(interval_seconds=5.0)
    conn = WritableFakeConn()
    stats = worker.poll_once(conn, dry_run=False)
    assert stats["rows_written"] == 9
    assert len(conn.written_rows) == 9
    assert conn.committed == 1
