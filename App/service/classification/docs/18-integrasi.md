# 18 — Integrasi Klasifikasi untuk Tim BE (Apps/Web)

> Refactor 2026-10-19: endpoint aktif hanya `POST /classify`,
> `/profile-setpoints`, dan `GET /health`. Endpoint file/CSV dihapus.
> Cutover 2026-10-20: backend Node.js (Socket.IO) menggantikan Python di `:3031`,
> kontrak input/output identik. Detail: `20-migrasi-nodejs.md`.

Kontrak stabil satu endpoint. Aturan 100% milik service ini; tim BE hanya mengirim data sensor dalam bentuk reading kanonis. Dexmin/SSE di luar skop dokumen ini.

## Endpoint

`POST /classify` — single-shot, stateless, tanpa CSV/storage/session.
Base lokal `http://127.0.0.1:3031`, produksi `https://class-api.aldozeno.my.id`.

### Auth

Header `X-API-Key: <CLASSIFICATION_API_KEY>`. Tanpa header/kunci salah → `401 {"detail": ...}`. Terbuka hanya bila env kosong (DEV). Terkecuali: `/` dan `/health`.

## Request

```json
{
  "profile_id": "5000_lps",
  "setpoint_freq": 40.0,
  "namespace": "96",
  "readings": [
    {
      "timestamp": "2026-06-12T14:33:56+07:00",
      "motor_speed": 990.0,
      "output_frequency": 40.0,
      "motor_current": 246.0,
      "motor_torque": 40.0,
      "output_power": 111.0,
      "input_voltage": 380.0,
      "ambient_temperature": 30.0,
      "control_board_temperature": 40.0,
      "inverter_temperature": 45.0
    }
  ]
}
```

Aturan main:

- `profile_id`: `500`/`3000`/`5000` + `_lps` (mis. `5000_lps`).
- `setpoint_freq`: opsional; override BE, else fallback profil (resolver milik server).
- `namespace`: ID site dari sistem BE (mis. `"96"`) — **wajib unik per site** (syarat isolasi counter di engine kami).
- `readings`: 1–40 sampel, **urut bebas** (server mengurutkan event-time). Kirimkan sampel terakhir yang dimiliki; **server yang memangkas** evidensi trailing 31 pasca-gap 10 dtk. Jendela pendek tetap bisa vonis turbulensi via referensi adaptif CMA (kondisi match mencatat `vs CMAn…` vs `vs MA30…`).
  Kenapa CMA ada: turbulensi mengukur deviasi dari kebiasaan arus (bukan angka mati), dan kebiasaan seadanya lebih berguna daripada menolak menilai — lihat `docs/06` §TURBULENSI "Kenapa rata-rata + deviasi". Vonis berlabel `CMA` berasal dari histori tipis: perlakukan dengan kewaspadaan lebih tinggi.
- `timestamp`: ISO-8601 **wajib ber-zona waktu** (waktu kejadian dari sensor, bukan waktu terima); naive → `422`.
- 16 field numerik semua nullable; **hilang = `null`, jangan `0`**; key asing diabaikan.

### Contoh panggil

```bash
curl -fsS -X POST https://class-api.aldozeno.my.id/classify \
  -H 'Content-Type: application/json' -H "X-API-Key: $CLASSIFICATION_API_KEY" \
  -d '{"profile_id":"5000_lps","namespace":"96","readings":[{"timestamp":"2026-06-12T14:33:56+07:00","output_frequency":40.0,"input_voltage":380.0}]}' | jq .classification.trouble_type
```

```python
import httpx
r = httpx.post(f"{BASE}/classify", json={
    "profile_id": "5000_lps", "namespace": namespace, "readings": readings[-40:],
}, headers={"X-API-Key": API_KEY}, timeout=30)
r.raise_for_status()
trouble = r.json()["classification"]["trouble_type"]
```

```js
const r = await fetch(`${BASE}/classify`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
  body: JSON.stringify({ profile_id: "5000_lps", namespace, readings: readings.slice(-40) }),
});
if (!r.ok) throw new Error((await r.json()).detail);
const { classification } = await r.json();
```

## Response 200

```json
{
  "profile_id": "5000_lps",
  "namespace": "96",
  "evidence_size": 12,
  "classification": {
    "pump_id": 5000,
    "timestamp": "2026-06-12T14:33:56+07:00",
    "trouble_type": "undervoltage",
    "matched_rules": [{ "trouble_type": "undervoltage", "matched_conditions": ["..."], "total_conditions": 1 }],
    "sensor_snapshot": { "input_voltage": 355.0 },
    "readings_count": 12,
    "limitations": [],
    "evaluation_status": "FULL",
    "rule_evaluations": [...]
  }
}
```

- `trouble_type`: 9 enum — `pompa_tersangkut_sampah`, `turbulensi`, `banyak_sampah`, `unbalance`, `undervoltage`, `overvoltage`, `dry_run`, `panel_overheat`, `normal`.
- `evaluation_status`: `FULL` (lengkap) / `PARTIAL` / `INSUFFICIENT_DATA`; data hilang → `tidak terdeteksi` + catatan di `limitations`.
- `evidence_size` < kiriman = gap memutus histori (normal, bukan error).

## Error

| Kode | Arti | Aksi BE |
|---|---|---|
| 401 | API key salah/hilang | perbaiki header |
| 404 | `profile_id` tak dikenal | cek `500/3000/5000_lps` |
| 422 | `readings` kosong/>40, timestamp naive, tak ada sampel layak | perbaiki mapping |
| 500 | galat internal | retry + laporkan body `detail` |

## Ambang lestari (jangan hardcode ulang di BE)

undervoltage < 360 V • overvoltage > 410 V • panel_overheat ≥ 60 °C • unbalance ≥ 10% • pompa tersangkut: frekuensi ≤ 10 Hz + minimal 3 dari 4 tanda (langsung diputuskan).

## Versioning

Perubahan `rules.json` tidak lagi terekspos lewat API (envelope tanpa `rules_version`); komunikasikan via catatan rilis + contract test (`tests/test_contract.py`) hijau. Bentuk request/response stabil; perubahan breaking butuh kesepakatan versi baru.

URL **tidak** memakai prefix versi (`POST /classify`, bukan `/v1/classify`). Kebijakan penamaan ada di `03-contracts.md`.
