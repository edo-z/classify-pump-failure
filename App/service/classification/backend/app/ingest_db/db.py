"""Koneksi MySQL worker (pymysql diimpor malas agar test tanpa driver tetap jalan).

Pengaman tulis (sementara, smoke-test):
  CLASSIFICATION_WRITE_ENABLED=true  -> tulis diizinkan, SELAIN itu ditolak.
  CLASSIFICATION_WRITE_TARGET=dexmin -> allowlist database tulis (koma).
  require_database() menolak operasi tulis/DROP bila database aktif
  di luar allowlist: stop + audit, TANPA menghapus apa pun.
Proteksi utama tetap hak user DB; ini lapis aplikasi.
"""

from __future__ import annotations

import os
from typing import Any


class WriteNotAllowedError(RuntimeError):
    """Dilempar bila tulis diminta tanpa izin eksplisit / di luar target."""


def write_enabled() -> bool:
    return os.getenv("CLASSIFICATION_WRITE_ENABLED", "false").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def write_targets() -> set[str]:
    raw = os.getenv("CLASSIFICATION_WRITE_TARGET", "dexmin")
    return {part.strip() for part in raw.split(",") if part.strip()}


def current_database(conn) -> str | None:
    with conn.cursor() as cur:
        cur.execute("SELECT DATABASE() AS db")
        row = cur.fetchone()
    if not row:
        return None
    return row.get("db") if isinstance(row, dict) else row[0]


def require_write_allowed(conn, operation: str = "write") -> str:
    """Validasi ganda sebelum tulis/DROP. Return nama database aktif.

    Menolak (raise) bila: WRITE_ENABLED tidak true, atau database aktif
    di luar allowlist. TIDAK pernah menghapus/mengubah apa pun sendiri.
    """
    if not write_enabled():
        raise WriteNotAllowedError(
            f"{operation} ditolak: CLASSIFICATION_WRITE_ENABLED bukan true"
        )
    active = current_database(conn)
    if active not in write_targets():
        raise WriteNotAllowedError(
            f"{operation} ditolak: database aktif {active!r} di luar "
            f"allowlist {sorted(write_targets())} — stop, audit manual"
        )
    return active


def db_config(prefix: str = "CLASSIFICATION_DB_") -> dict[str, Any]:
    return {
        "host": os.getenv(prefix + "HOST", "127.0.0.1"),
        "port": int(os.getenv(prefix + "PORT", "3306")),
        "user": os.getenv(prefix + "USER", "root"),
        "password": os.getenv(prefix + "PASSWORD", ""),
        "database": os.getenv(prefix + "NAME", "dexmin"),
        "charset": "utf8mb4",
        "connect_timeout": int(os.getenv(prefix + "CONNECT_TIMEOUT", "10")),
    }


def connect(**overrides: Any):
    """Buka koneksi MySQL (DictCursor). Import pymysql di sini (lazy)."""
    try:
        import pymysql
        from pymysql.cursors import DictCursor
    except ImportError as exc:
        raise RuntimeError(
            "pymysql belum terpasang di environment ini "
            "(tambah ke requirements / venv worker)"
        ) from exc
    cfg = db_config()
    cfg.update(overrides)
    return pymysql.connect(
        host=cfg["host"],
        port=cfg["port"],
        user=cfg["user"],
        password=cfg["password"],
        database=cfg["database"],
        charset=cfg["charset"],
        connect_timeout=cfg["connect_timeout"],
        cursorclass=DictCursor,
        autocommit=False,
    )
