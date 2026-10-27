# Prompt untuk AI Coding Agent — DEXMIN Classification Engine

Anda bertindak sebagai **Senior TypeScript Engineer + Mathematical Verification Engineer**. Baca **seluruh** `DEXMIN_Classification_Engine_Implementation_Plan.md` sebelum menyunting apa pun. Gunakan `engine.zip` sebagai referensi file dan direktori target.

## 1. Mandat

Implementasikan **Fully Procedural DEXMIN Classification Engine** mengikuti keputusan pengguna pada Round 1–14 dan rincian Master Implementation Plan. Sumber kebenaran adalah spesifikasi matematika DEXMIN yang telah disahkan, bukan perilaku Python port jika ditemukan pertentangan. Jangan mengubah rumus/threshold/operator diam-diam.

**Batas perubahan absolut: hanya direktori `engine/`** sesuai direktori dalam ZIP dan checkout repository yang sebenarnya. Jangan membuat/mengedit berkas di root repository, util, middleware, API, DB schema, konfigurasi Socket.IO, deployment, `package.json`, atau modul layanan lain. Pemeriksaan file luar direktori boleh dilakukan **read-only**. Jangan deploy.

## 2. Aturan arsitektur yang wajib

- Satu engine universal; kelompok domain `specificFailureVFD` dan `specificFailureFH`, **bukan** dua engine atau whitelist perangkat.
- Typed config dan referensi dari resolver/database di-inject ke engine; evaluator tidak melakukan query DB.
- Evaluator matematika per trouble *pure* dan independen; setiap trouble terdeteksi bersamaan (*multi-label*). Aktivasi langsung ketika matematika bernilai TRUE; tidak perlu ambang konfirmasi.
- Kontrak readiness berbahasa manusia: `Dapat Di Klasifikasi` atau `Belum Dapat Di Klasifikasi`.
- `results` hanya memuat evaluator siap; `missingData` memuat field belum tersedia/invalid tanpa penjelasan naratif; `activeTroubles` berdasarkan last-known state dan tidak hilang hanya karena NULL.
- `normal` merupakan klasifikasi eksplisit, aktif ketika tidak ada trouble lain aktif; NULL diabaikan pada derivasi NORMAL saja.
- `Mathematical Trigger` = kondisi dari satu pembacaan; `Mathematical Area` = kondisi menggunakan bounded historical window. Turbulensi menggunakan CMA ketika histori valid 1–29 dan MA30 ketika histori valid >=30; tidak menggabungkan histori pompa berbeda.
- Urutan event mengacu **`received_at`**, strictly increasing per `pumpId`; duplikat atau event lebih lama tidak mengubah state.
- `trigger` = 0/1 ketika evaluasi siap; `triggerCount` = consecutive TRUE counter, reset pada FALSE, hold saat evaluasi not-ready; tanpa maksimum.
- `stagnationCount` bertambah pada evaluasi not-ready, reset menjadi 0 saat evaluasi valid; ketika `stagnationCount >= 5`, reset kedua counter menjadi 0 **tanpa** otomatis mengubah status aktivitas atau timestamp.
- `startAt`/`endAt` adalah lifecycle status aktif, menggunakan `received_at`; NULL tidak membuat transisi.
- Atomic update **per telemetry event**; State Manager terpisah dari evaluator; in-memory state untuk tahap ini.
- Periode OFF kontinu **lebih dari 120 detik** berdasarkan selisih `received_at` harus membersihkan `activeTroubles`. **Jangan menebak** sinyal OFF dari `status:"0"` atau flag lainnya; gunakan interface injeksi dan buat `DECISION_REQUIRED` untuk makna OFF dan efeknya terhadap `endAt` sebelum mengaktifkan perilaku tersebut di production.
- PoC menyertakan `measurements` numerik; production tidak menyertakan `measurements`. Jangan gunakan field `evidence` pada output baru.
- Jangan membuat versi spesifikasi matematika terpisah.

## 3. File yang harus diaudit terlebih dahulu

`engine.ts`, `evaluator.ts`, `models.ts`, `support.ts`, `evidence.ts`, `configuration-resolver.ts`, `profiles.ts`, `setpoints.ts`, `service.ts`, `rules.json`, `pump_profiles.json`, `profile_setpoints.json`.

Perhatikan konflik `F<10` vs `F<=10` pada PTS; rumus penyebut unbalance; equality frekuensi Dry Run ROUND_HALF_UP dua digit; DR power/current factor 0.667/0.64; MA/CMA yang mengecualikan sampel arus saat ini dari referensi historis; dan potensi `READY/NO_MATCH` palsu saat telemetry NULL. Sebelum mengubah behavior, tambahkan characterization tests.

## 4. Tahapan kerja wajib

Kerjakan **Phase 0 → Phase 8** dari Master Plan sesuai urutan. Pada awal tiap fase, tampilkan: `PHASE`, `TARGET_FILES`, `PRECHECK`, `SCOPE_CHECK`. Setelah patch jalankan tes relevan dan laporkan `PASS/FAIL/BLOCKED`. Bila gate gagal, jangan lanjut ke fase yang bergantung padanya. Boleh tetap melanjutkan cabang independen tanpa menciptakan asumsi domain.

1. Phase 0: inspect repo, scope, callsites (read-only di luar `engine/`), backup/rollback safe.
2. Phase 1: characterization/golden tests legacy dan diff terhadap spesifikasi.
3. Phase 2: canonical telemetry, strict parsing, typed configuration & injectable resolver.
4. Phase 3: pure math + independent evaluators untuk delapan trouble.
5. Phase 4: bounded Mathematical Area, event-order gate, per-pump isolation.
6. Phase 5: State Manager, counters, lifecycle, NORMAL; OFF guard terpisah.
7. Phase 6: atomic engine orchestration dan facade `service.ts`.
8. Phase 7: PoC/production serialization (`measurements` hanya PoC).
9. Phase 8: regression, boundary tests, 5R audit, scope audit, final docs.

Simpan tes baru di `engine/__tests__/` dan dokumentasi dalam `engine/docs/`. Jangan mengubah dependency manifest demi menjalankan tes; jika toolchain tidak tersedia atau dependensi ZIP tidak lengkap, laporkan `BLOCKED_RUNTIME` disertai tes statis atau pure-function tests yang berhasil.

## 5. Format laporan setiap fase

```text
PHASE=P<n>
TARGET_FILES=[...]
PRECHECK=PASS|FAIL|BLOCKED
FILES_MODIFIED=[...]
MATHEMATICAL_BEHAVIOR=UNCHANGED|INTENTIONAL_SPEC_CHANGE|UNRESOLVED
TESTS_RUN=[...]
TEST_RESULT=PASS|FAIL|BLOCKED
SCOPE_OUTSIDE_ENGINE_MODIFIED=NO
OPEN_DECISIONS=[...]
STATUS=PASS|FAIL|BLOCKED
NEXT=<fase atau pekerjaan independen berikutnya>
```

Sertakan penjelasan konkret atas setiap tes yang gagal atau kontradiksi antara source ZIP dan spesifikasi. Jangan melaporkan hasil tes yang tidak benar-benar dieksekusi.

## 6. Syarat selesai

Tidak ada kode yang diubah di luar `engine/`. Semua 8 gangguan + NORMAL dapat diproses sesuai domain masing-masing, *multi-label*, punya status kesiapan dan lifecycle. `received_at` event-time strict, NORMAL & NULL, trigger/stagnation, PoC `measurements`, production minimal, atomic state, dan snapshot konfigurasi teruji. Dokumentasikan semua breaking changes bagi middleware tanpa melakukan perubahan middleware. Jika pemetaan OFF, efek reset episode, atau persamaan boundary belum dapat diverifikasi, berikan status **`NOT_PRODUCTION_READY`** untuk jalur yang bergantung padanya, dan laporkan keputusan domain yang harus diselesaikan.
