"""C8 — DELETE dokumen: 200 + 404 + 409 saat dipakai (5R Rawat)."""

from fastapi.testclient import TestClient

from app.data_pipeline import service as pipeline
from app.main import app

FILENAME = "vat_delete_probe.csv"
CSV = (
    "Start Time (WIB),Motor Speed used,Output Frekuensi,"
    "Motor current,Motor torque,Output power,"
    "Ambient temperature,Control board temperature,"
    "Inverter temperature\n"
    "2026-06-12 14:33:56,990,40.0,246.0,40.0,111.0,"
    "30.0,40.0,45.0\n"
    "2026-06-12 14:34:00,990,40.0,246.0,40.0,111.0,"
    "30.0,40.0,45.0\n"
).encode()


def test_delete_flow_409_200_404():
    c = TestClient(app)
    try:
        up = c.post(
            f"/documents/upload?filename={FILENAME}",
            content=CSV,
            headers={"Content-Type": "text/csv"},
        )
        # 409 = sisa run gagal sebelumnya, tetap bisa lanjut.
        assert up.status_code in (201, 409), up.text

        # Sedang dianalisis -> tolak 409.
        pipeline.mark_document_in_progress(FILENAME)
        try:
            busy = c.delete(f"/documents/{FILENAME}")
            assert busy.status_code == 409, busy.text
        finally:
            pipeline.unmark_document_in_progress(FILENAME)

        # Bebas -> hapus 200 + file pindah ke .trash (bisa dikembalikan).
        gone = c.delete(f"/documents/{FILENAME}")
        assert gone.status_code == 200, gone.text

        from app.data_pipeline.document_storage import STORAGE_ROOT

        trashed = list((STORAGE_ROOT / ".trash").glob(f"*{FILENAME}*"))
        assert trashed, "file harus pindah ke .trash, bukan hilang"

        # Sesudah hapus -> baca 404, hapus lagi 404.
        assert c.get(f"/documents/{FILENAME}").status_code == 404
        assert c.delete(f"/documents/{FILENAME}").status_code == 404
    finally:
        pipeline.unmark_document_in_progress(FILENAME)
        c.delete(f"/documents/{FILENAME}")
