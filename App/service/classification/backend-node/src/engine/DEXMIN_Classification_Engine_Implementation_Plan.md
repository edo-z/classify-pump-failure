# DEXMIN Classification Engine — Master Implementation Plan

**Status:** Rencana eksekusi untuk AI coding agent; **belum mengotorisasi perubahan di luar direktori `engine/`**.  
**Basis inspeksi:** berkas `engine.zip` yang memuat direktori `engine/` dengan 12 berkas, bertanggal 19–22 Oktober 2026.  
**Ruang lingkup:** refactoring dan pengembangan internal Classification Engine TypeScript saja.  
**Prinsip:** *mathematical specification is the source of truth*; API, kode, konfigurasi, database, dan Socket.IO adalah bentuk implementasi/integrasi.  
**Target:** satu *Fully Procedural*, multi-label classification engine; evaluator independen, konfigurasi bertipe, state atomik, keluaran PoC/production, dan audit perilaku.

> **INSTRUKSI UTAMA KEPADA AI AGENT**  
> Pekerjaan **hanya boleh mengubah/menambah/menghapus berkas di dalam direktori `engine/` yang terdapat dalam ZIP**, sesuai jalur padanannya pada repository aktual. Jangan menulis ke `../util/`, root project, API, middleware, database schema, Socket.IO server, `package.json`, konfigurasi deployment, atau layanan lain. Inspeksi secara **read-only** terhadap pemanggil di luar `engine/` boleh dilakukan untuk memahami kontrak, tetapi perubahan integrasi harus dicatat sebagai tindak lanjut, tidak dikerjakan dalam tugas ini. Jangan mengubah persamaan matematika secara spekulatif. Setiap fase wajib memiliki tes, bukti, dan kriteria lulus. Bila spesifikasi yang telah disahkan belum cukup untuk memilih perilaku, tandai `DECISION_REQUIRED`; jangan menyamarkan asumsi menjadi fakta.

---

## A. Inventaris faktual codebase di `engine.zip`

| Berkas existing | Peran sekarang | Temuan spesifik yang relevan |
|---|---|---|
| `engine/engine.ts` | `RulesEngine`, membaca `rules.json`, `matchRule`, trigger counter, orkestrasi, memilih gangguan utama | `RulesEngine.classify()` menggunakan `rules_match[0]` (first match); `matchRule()` mengubah makna `AND` ketika ada 5 atau 6 kondisi; `_trigger_counters` memegang state dalam engine; status keseluruhan hanya `FULL` atau `INSUFFICIENT_DATA` dalam jalur yang diperiksa. |
| `engine/evaluator.ts` | `evaluateTierRules`, `evaluatePanel`, `evaluateUnbalance`, `evaluateVoltage` | `evaluateTierRules` menggabungkan perilaku PTS, Dry Run, Turbulensi, dan generic matcher; banyak logika terikat ke `trouble_name`; panel/voltage/unbalance dapat mencatat `READY` + `NO_MATCH` saat input `null`; Dry Run mengambil referensi dari rule PTS. |
| `engine/support.ts` | MA/CMA, pembanding frekuensi, agregasi, helper | `computeTA()` mengambil data historis **sebelum** pembacaan saat ini, minimum satu pembacaan historis valid; memakai CMA jika sampel historis `< window` dan MA jika `>= window`; `getMissingRequirements()` dan `getMissingOrRequirements()` tersedia tetapi tidak dipanggil oleh alur yang terlihat. |
| `engine/models.ts` | Tipe input/output, daftar trouble | Delapan gangguan: `pompa_tersangkut_sampah`, `turbulensi`, `banyak_sampah`, `unbalance`, `undervoltage`, `overvoltage`, `dry_run`, `panel_overheat`; ditambah `normal`. Kontrak masih `snake_case` dan cenderung single primary trouble. |
| `engine/configuration-resolver.ts` | Fallback nilai referensi | Prioritas saat ini `override -> flowhead -> profile`; `cleanPositive` perlu memastikan `Number.isFinite` karena Infinity tidak semestinya valid. `applyEffectiveRefs()` memodifikasi salinan struktur rule lama. |
| `engine/profiles.ts` | Membaca `pump_profiles.json` | Mendapatkan kapasitas dari `profile_id`. |
| `engine/setpoints.ts` | Membaca/menulis setpoint dari file JSON | Ada efek samping file-system dan dependensi `../util/pyjson.ts`; pertahankan pembacaan legacy untuk migrasi, tetapi pisahkan dari perhitungan. |
| `engine/evidence.ts` | Riwayat trailing dan deteksi gap | `EVIDENCE_MAXLEN=31` (30 historis + 1 saat ini); default `LIVE_GAP_THRESHOLD_MS=10000`. Ambang gap ini adalah perilaku **existing**, bukan keputusan baru yang sudah disahkan. |
| `engine/service.ts` | Factory singleton `getEngine()` | Membuat `RulesEngine` satu kali; perlu API baru yang kompatibel dengan state dan dependency injection. |
| `engine/rules.json` | Aturan per kapasitas dan capability | Tier `500`, `3000`, `5000`, dan `panel_overheat`; unbalance `>=10%`, undervoltage `<360V`, overvoltage `>410V`, panel overheat `>=60°C` dari tiga suhu. |
| `engine/pump_profiles.json` | Referensi berbasis profil | Menyimpan rujukan matematis dengan salah satu konflik nyata: frekuensi PTS tertulis `<10`, sementara `rules.json`/evaluator memakai `<=10`. `motor_estimated_temperature` diberi status sumber tidak lengkap. |
| `engine/profile_setpoints.json` | Setpoint contoh untuk profil | `500_lps=46.1Hz`, `3000_lps=38Hz`, `5000_lps=40Hz` saat ZIP dibuat; **jangan** otomatis menganggapnya setpoint produksi terkini. |

**Batas verifikasi:** ZIP tidak memuat `package.json`, test suite, modul `../util/timestamp.ts`, `../util/pyformat.ts`, `../util/pyjson.ts`, ataupun instalasi `decimal.js`. Karena itu ZIP saja belum memadai untuk menjamin seluruh proyek dapat dijalankan. Agent harus memeriksa repository aktual secara read-only dan melaporkan baseline; tidak boleh menambahkan dependensi di luar `engine/` tanpa otorisasi baru.

### Perbedaan penting yang harus diaudit, bukan diam-diam 'diperbaiki'

1. **PTS frekuensi:** `rules.json` `<=10` versus `pump_profiles.json` `<10`; boundary tepat 10 Hz harus diputuskan menggunakan spesifikasi matematika yang sah.
2. **Unbalance:** evaluator sekarang menghitung `(rataRata − arusFasa) / arusFasa ×100`, lalu OR nilai absolut tiga fasa. Jangan mengganti penyebut dengan rata-rata sebelum spesifikasi rumus final diverifikasi.
3. **Dry Run:** evaluator sekarang memeriksa `DR_F`, daya `<=0.667 × kW_ref`, arus `<=0.64 × A_ref`, dan torsi `<70`, dengan pembandingan frekuensi pembulatan dua desimal `ROUND_HALF_UP`. Kontrak historis untuk `DR_C` dan operator penggabungan harus diuji terhadap spesifikasi yang telah disahkan.
4. **Turbulensi:** implementasi existing menggunakan arus saat ini terhadap MA/CMA dari **sampel historis** dan ambang deviasi 10 A, bukan rata-rata termasuk arus saat ini. Jendela total pada baseline existing dapat mencapai 31 sampel.
5. **Panel Overheat:** OR suhu ambient/control-board/inverter `>=60°C`; aturan evaluasi saat sebagian input NULL perlu ditetapkan deterministik.
6. **Count trigger lama:** `count_trigger`/`freq_sustain` yang dapat menunda *emission* adalah mekanisme legacy; spesifikasi baru memilih *Immediate Activation* dan `triggerCount` untuk durasi/keberlanjutan. Tidak boleh mempertahankan gating lama secara tersembunyi.
7. **Voltage, unbalance, panel readiness:** NULL yang dibalas `NO_MATCH/READY` pada kode lama bertentangan dengan kebutuhan `missingData` terpisah; migrasi harus dapat membedakan `not ready` dari `false`.
8. **Normal lama:** `normal` ketika `rules_match` kosong, bukan suatu hasil per-trouble dengan lifecycle. Perlu diganti sesuai keputusan yang terbaru.

---

## B. Decision Register — keputusan pengguna yang mengikat

| Area | Keputusan final / terakhir yang berlaku |
|---|---|
| Tujuan | *Behavioral preservation* terhadap **spesifikasi matematika yang disahkan**, bukan melestarikan bug port Python. Semua perubahan perilaku dari legacy wajib dicatat sebagai migrasi spesifikasi. |
| Arsitektur | Satu engine **Fully Procedural TypeScript**, bukan JSON rule interpreter, bukan Strategy Pattern class berlebihan. Persamaan dan operator di kode; database/konfigurasi memasok nilai numerik dan referensi. |
| Kompatibilitas | Breaking changes internal/kontrak dimungkinkan. Tidak ada kewajiban mempertahankan `snake_case` pada domain internal. |
| Scope | Hanya direktori `engine/`; API/database/Socket.IO nyata tidak diedit. |
| Evaluasi | Masing-masing `troubleType` independen; multi-label; **immediate activation** begitu rumus bernilai TRUE. |
| Kelompok | `specificFailureVFD` dan `specificFailureFH` adalah kategori domain, **bukan** pemisahan dua engine. Belum ada whitelist *supported failure* berdasarkan device: **Universal Classification**. |
| Konfigurasi | `flowhead` (contoh `500`) adalah karakteristik Flowhead; `vsdTypeId` adalah identifier numerik jenis/brand VFD; parameter bisa berasal dari DB melalui resolver, lalu disuntikkan sebagai *typed config*. Tidak melakukan query DB dari evaluator. |
| Readiness | Status per trouble: `Dapat Di Klasifikasi` / `Belum Dapat Di Klasifikasi`. Kesiapan terpisah dari deteksi. Output `results` **hanya** klasifikasi yang dapat dievaluasi; yang belum siap masuk `missingData`, **tanpa `reason` naratif**. |
| NULL | Input `null` tetap `null` dan tidak boleh diisi `0`; string angka valid diparsing ketat; string `"false"` bukan boolean `true`. Tidak ada trigger baru untuk evaluator yang tidak siap. |
| Normal | `NORMAL` klasifikasi **eksplisit**, aktif jika tidak ada trouble lain yang aktif. NULL diabaikan untuk menentukan NORMAL, termasuk jika semuanya NULL; jangan mengubah NULL menjadi FALSE pada persamaan gangguan. |
| Terminologi | `Mathematical Trigger` (satu pembacaan), `Mathematical Area` (jendela pengukuran), `Trigger Count` (akumulasi TRUE), `Stagnation Count` (jumlah evaluasi tanpa keputusan valid). |
| Trigger Count | Nilai awal 0; TRUE menambah 1; FALSE reset 0; tidak ada maksimum/reset siklik; NULL mempertahankan hitungan. Counter adalah state per `troubleType` **dalam konteks pompa yang terisolasi**. |
| Stagnation | Ketika evaluasi tidak dapat menghasilkan keputusan baru, `stagnationCount` bertambah. TRUE/FALSE valid mereset `stagnationCount` ke 0. `limitStagnan=5`; pada hitungan `>=5`, reset `triggerCount=0` dan `stagnationCount=0`, **tetapi detected dan lifecycle tidak berubah**. |
| Lifecycle | Setiap trouble (termasuk NORMAL) memiliki `startAt`, `endAt`. TRUE transisi nonaktif→aktif menetapkan startAt; FALSE transisi aktif→nonaktif menetapkan endAt; NULL tidak membuka/menutup episode. Gunakan `received_at` sebagai event-time. |
| Temporal | Bounded window per `pumpId`+parameter; reuse kalkulasi tanpa mencampur pompa; MA/CMA untuk turbulensi saat <30/≥30 sampel historis. Event hanya diproses ketika `received_at` **lebih besar** daripada event yang terakhir diterima pompa tersebut; duplikat/out-of-order ditolak tanpa mutasi state. |
| State | In-memory untuk fase ini, State Manager terpisah, atomik per event; histori jangka panjang tanggung jawab database/middleware. |
| Results | `results` untuk evaluasi siap, `missingData` terpisah, `activeTroubles` dari state terakhir yang diketahui (termasuk ketika eval terbaru NULL). |
| OFF | **Pengecualian penting:** ketika pompa **terdeteksi OFF kontinu selama lebih dari 120 detik** menurut selisih `received_at`, `activeTroubles` langsung di-reset; jangan terus mewariskan activeTroubles lama. Sumber sinyal OFF dari payload **belum terverifikasi**; jangan menganggap `status: "0"` pasti OFF. |
| Konfigurasi berubah | Snapshot config berlaku dari event berikutnya; histori tidak dievaluasi ulang otomatis. Kebijakan reset state karena perubahan konfigurasi masih perlu dipastikan. |
| Output | **PoC:** sertakan angka/perhitungan dalam properti **`measurements`** (jangan gunakan istilah `evidence`). **Production:** respons minimal, `measurements` tidak dikirim. Satu algoritma untuk dua mode serialisasi. |
| Versioning | **Tidak membuat mekanisme pelacakan versi spesifikasi matematika terpisah**. Tolak rekomendasi Q68. |

### Posisi open decisions (jangan diklaim sudah disahkan)

- **OD-01 — Pendeteksian OFF.** Field mana yang sah menyatakan pompa OFF? Sampel mengandung `status`, `vsd_standby`, `pump_fault`, dll., tetapi semantiknya tidak disertakan. Agent dilarang menebak. Sediakan fungsi/port `isPumpOff` yang diinjeksi dan hanya menerima pemetaan OFF yang terverifikasi; uji OFF dengan fixture eksplisit.
- **OD-02 — Akibat reset OFF 120 detik pada lifecycle.** Agar `activeTroubles` yang bersumber dari State Manager tidak muncul kembali pada event berikutnya, usulan implementasi adalah menutup episode aktif (`endAt=receivedAt`) serta membersihkan aktivitas dan counter/window terkait. **Ini rancangan yang memerlukan persetujuan**, karena pengguna secara eksplisit hanya menyatakan reset `activeTroubles`. Beri tag `DECISION_REQUIRED` sebelum mengaktifkan kebijakan ini di production.
- **OD-03 — Perubahan konfigurasi saat sebuah trouble aktif.** Keputusan penerapan snapshot baru sudah final; reset/pertahankan state dan jendela pada perubahan threshold/referensi belum final. Harus ada kebijakan eksplisit sebelum dipakai dengan hot reload.
- **OD-04 — Truth table AND/OR ketika sebagian operand NULL.** Tentukan apakah evaluasi boleh “siap” bila outcome sudah pasti (`TRUE OR NULL` = TRUE; `FALSE AND NULL` = FALSE) atau mewajibkan semua parameter hadir. Jangan menggeneralisasi diam-diam; nilai `NULL` tetap diperlihatkan pada sumbernya.
- **OD-05 — Kontrak sumber pengukuran:** `output_current` vs `motor_current`, `output_torsi` vs `motor_torque`, `realtime_running_frequency` vs `output_frequency` belum terbukti setara. Masing-masing mapping harus diverifikasi dengan sumber perangkat/middleware.
- **OD-06 — Timezone `received_at`** berupa string tanpa offset (`YYYY-MM-DD HH:mm:ss`); sumber dan timezone harus dijelaskan dalam kontrak input agar penentuan 120 detik tidak tergantung timezone proses server.
- **OD-07 — Kebijakan gap 10 detik dari `evidence.ts`.** Eksisting punya reset histori pada gap >10 s; apakah tetap untuk seluruh Mathematical Area atau hanya flow live tertentu harus diuji terhadap spesifikasi. Jangan menghapus perilaku tanpa karakterisasi.
- **OD-08 — Persamaan domain yang berbeda antarberkas:** PTS `<` vs `<=` pada 10 Hz; rumus unbalance penyebut; Dry Run kombinasi; jangan menyatakan kesetaraan terhadap spesifikasi sampai dikonfirmasi melalui test oracle matematis.

**Aturan lanjut:** OD yang membutuhkan keputusan domain bukan alasan untuk mengubah scope atau mengarang. Kerjakan modul, kontrak, dan pengujian yang tidak bergantung pada OD tersebut; letakkan *guard* eksplisit pada jalur yang belum disahkan.

---

## C. Peta arsitektur target (semua kode baru tetap di `engine/`)

```text
engine/
├── engine.ts                         # orkestrator tunggal, transaksi per telemetry event
├── service.ts                        # factory/facade + dependency injection
├── models.ts                         # domain types: canonical input/result/state/config
├── telemetry.ts                      # NEW: parsing & canonical source mapping
├── configuration-resolver.ts         # typed config resolution (tanpa query DB)
├── configuration.ts                  # NEW: schema/validators/threshold typed
├── evaluator.ts                      # orkestrasi evaluator modular, tanpa god function
├── evaluators/                       # NEW: fungsi matematika per trouble type
│   ├── flowhead.ts                   # PTS, TURBULENSI, BANYAK_SAMPAH, DRY_RUN
│   ├── vfd.ts                        # UNBALANCE, UNDERVOLTAGE, OVERVOLTAGE, PANEL_OVERHEAT
│   └── normal.ts                     # derivasi eksplisit NORMAL dari state aktif
├── mathematics/                      # NEW: rumus dasar yang dapat di-unit-test
│   ├── frequency.ts                  # kesetaraan frekuensi dengan pembulatan sesuai spesifikasi
│   ├── moving-average.ts             # CMA/MA, deviasi terhadap referensi historis
│   └── three-phase.ts                # rumus unbalance yang telah disahkan
├── state/                            # NEW: state murni, terpisah dari evaluator
│   ├── manager.ts                     # in-memory Map per pumpId + troubleType
│   ├── transition.ts                  # reducer murni trigger/stagnasi/lifecycle
│   └── window.ts                      # bounded window per pumpId/parameter
├── output/                           # NEW: serialisasi PoC/production
│   └── serializer.ts
├── evidence.ts                       # legacy helper history: audit/migrasi bertahap
├── support.ts                        # pertahankan helpers yang terbukti terpakai
├── profiles.ts                       # legacy loader atau facade untuk migration
├── setpoints.ts                      # legacy local storage, bukan source of truth production
├── rules.json                        # data existing: migration/fixture; bukan rule interpreter runtime
├── pump_profiles.json               # data existing: migration/fixture
├── profile_setpoints.json            # data existing: migration/fixture
├── __tests__/                         # NEW: tes di dalam scope yang sama
│   ├── fixtures/
│   ├── baseline.test.ts
│   ├── mathematics.test.ts
│   ├── normalization.test.ts
│   ├── state.test.ts
│   ├── lifecycle.test.ts
│   ├── output-contract.test.ts
│   └── integration.test.ts
└── docs/                              # NEW: laporan audit dan keputusan
    ├── DECISION_REGISTER.md
    ├── FORMULA_MATRIX.md
    ├── BASELINE_DIFF.md
    ├── IMPLEMENTATION_REPORT.md
    └── OPEN_DECISIONS.md
```

Peta adalah **target tanggung jawab**, bukan kewajiban membuat semua berkas/class. Agent dapat menggabungkan modul kecil jika lebih bersih; dilarang menambahkan `StrategyFactory`, event bus, framework DI, DSL JSON, atau pola abstraksi yang tidak dibutuhkan. Semua tambahan tetap di bawah `engine/`.

### Dependensi searah

```text
service.ts
  └─ engine.ts  ← typed config + canonical telemetry
       ├─ evaluator.ts → evaluators/* → mathematics/*
       ├─ state/manager.ts → state/transition.ts + state/window.ts
       └─ output/serializer.ts

telemetry.ts + configuration-resolver.ts → models.ts
```

**Larangan dependensi:** fungsi evaluator **tidak** boleh membaca DB/file, emit Socket.IO, mengakses shared Map langsung, atau memilih primary trouble. Matematik harus *pure*; state transition dapat diuji tanpa I/O. `normal` dihitung **setelah** state gangguan lain diperbarui secara atomik, sehingga tidak menjadi ketergantungan tersembunyi antarevaluator.

---

## D. Kontrak tipe dan antarmuka minimum

Contoh berikut **rancangan**, bukan implementasi final yang dapat langsung dikompilasi. Tipe eksternal menerima raw payload sekarang, lalu dinormalisasi.

```typescript
export const TroubleType = {
  POMPA_TERSANGKUT_SAMPAH: "pompa_tersangkut_sampah",
  TURBULENSI: "turbulensi",
  BANYAK_SAMPAH: "banyak_sampah",
  DRY_RUN: "dry_run",
  UNBALANCE: "unbalance",
  UNDERVOLTAGE: "undervoltage",
  OVERVOLTAGE: "overvoltage",
  PANEL_OVERHEAT: "panel_overheat",
  NORMAL: "normal",
} as const;

type ClassificationStatus =
  | "Dapat Di Klasifikasi"
  | "Belum Dapat Di Klasifikasi";

type Evaluation =
  | { ready: true; trigger: 0 | 1; measurements: Record<string, number | string | null> }
  | { ready: false; missingData: string[] };

interface TroubleState {
  detected: boolean;
  triggerCount: number;
  stagnationCount: number;
  startAt: string | null;
  endAt: string | null;
}

interface TroubleResult {
  troubleType: string;
  status: "Dapat Di Klasifikasi";
  detected: boolean;
  triggerCount: number;
  startAt: string | null;
  endAt: string | null;
  measurements?: Record<string, number | string | null>; // PoC ONLY
}

interface ClassificationOutput {
  pumpId: string;
  receivedAt: string;
  results: TroubleResult[];                       // ready ONLY
  missingData: Record<string, string[]>;         // not ready ONLY
  activeTroubles: string[];                       // last-known state
}

type OutputMode = "poc" | "production";
```

**Catatan kontrak:** `stagnationCount` boleh menjadi bagian internal state saja; tidak harus ada di output minimal. Nama `measurements` wajib dipakai, **bukan `evidence`**. Hindari `detected:null` di `results` karena item `not ready` dipindahkan ke `missingData`; untuk `not ready` secara konseptual tidak dihasilkan boolean baru. `NORMAL` masuk katalog trouble type dan memiliki lifecycle yang sama. Untuk timestamp selesai, hasil event ketika FALSE yang valid tetap dapat menyertakan episode terakhir (`startAt` yang lama, `endAt` baru); event aktivasi berikutnya membuka episode baru.

### Typed config & repository boundary

```typescript
interface EquipmentIdentity {
  pumpId: string;
  flowhead: number | null;
  flowheadId: number | null;
  vsdTypeId: number | null;
}

interface ClassificationConfig {
  flowhead: {
    powerRefKw: number | null;
    currentRefA: number | null;
    frequencySetpointHz: number | null;
    // parameter khusus PTS, turbulensi, banyak sampah, dry run
  };
  vfd: {
    // threshold voltase, ketidakseimbangan, temperatur, dll.
    // nilai dapat diselesaikan dari vsdTypeId tanpa membatasi klasifikasi universal
  };
  runtime: { stagnationLimit: 5; outputMode: OutputMode };
}

interface ConfigurationProvider {
  resolve(identity: EquipmentIdentity): Promise<ClassificationConfig>;
}
```

Jangan mengikat `ConfigurationProvider` pada library DB tertentu. Boleh menerima snapshot yang sudah disiapkan middleware melalui API factory. Jika fungsi `classify()` hendak sinkron, lakukan `await provider.resolve()` di service/facade sebelum memanggil evaluator sinkron; jangan mencampur query async ke perhitungan matematis. `flowhead` adalah nilai kapasitas; `flowhead_id` identifier profil yang berbeda; `vsdTypeId` angka, bukan nama perangkat yang harus dikirim ulang.

### Normalisasi raw telemetry (contoh sumber, bukan kesetaraan semantik)

| Raw field contoh | Target canonical | Aturan |
|---|---|---|
| `pump_id: "34"` | `pumpId: "34"` | Pertahankan identifier deterministik; normalisasi tanpa kehilangan nilai. |
| `received_at` | `receivedAt` (epoch + representasi serialisasi) | Hanya timestamp valid; timezone ditentukan eksplisit oleh kontrak. |
| `flowhead: 500` | `flowhead: 500` | Nilai kapasitas; tidak sama dengan `flowhead_id`. |
| `vsdTypeId: 2` | `vsdTypeId: 2` | Resolver boleh mencari brand/seri di luar evaluator. |
| `output_frequency: "0"` | `frequencyHz` | Kandidat; jangan auto-substitusi dari `realtime_running_frequency`. |
| `motor_current: "0.00"` | `currentA` | Kandidat; `output_current` perlu audit makna perangkat. |
| `output_power: "37.26"` | `powerKw` | Parse angka finite. |
| `motor_torque: "0"` | `torquePercent` | Kandidat; tidak otomatis sama dengan `output_torsi`. |
| `arus_rms_u/v/w: null` | `phaseCurrentU/V/W: null` | Tiga fasa independen; tidak zero-fill. |
| `input_voltage: null` | `inputVoltageV: null` | Tidak dievaluasi sebagai 0 V. |
| `ambient_temperature`, `control_board_temperature`, `inverter_temperature` | tiga temperatur | Tetap terpisah untuk OR panel. |
| `status: "0"` | `runState` **belum ditetapkan** | Dilarang menganggap OFF sampai semantik middleware terverifikasi. |

Parser: trim string angka non-kosong, tolak NaN, Infinity, string heksadesimal bila tidak disahkan, string kosong, dan nilai nonnumerik; `"0"` tetap numerik 0; `"false"` menjadi boolean false hanya jika field memang boolean. Hindari `Number(null)`, `Number("")`, dan `Boolean("false")` tanpa pemeriksaan.

---

## E. Spesifikasi pemrosesan setiap telemetry event

1. **Receive & validate envelope**: payload punya `pump_id`, `data`, `received_at` valid dan identitas konsisten. Penolakan input envelope/timestamp adalah event-level error, **bukan** hasil `NORMAL`.
2. **Order gate**: per `pumpId`, terima event hanya bila epoch `receivedAt > lastAcceptedReceivedAt`. Event duplikat/out-of-order tidak mengubah window, counter, lifecycle, ataupun output status terkini; boleh mengembalikan status `ignored` internal.
3. **Normalization**: konversi field raw yang dipetakan menjadi canonical `number | null` secara ketat; jangan campur nilai raw pengirim dan nilai hasil parse.
4. **Resolve typed config**: gunakan snapshot config immutable untuk seluruh evaluator pada event ini. Jika config sebuah klasifikasi hilang, masukkan field `config.*` pada `missingData` klasifikasi tersebut, bukan fallback diam-diam ke angka random/default.
5. **Read current state/window snapshot**: copy state per pompa dan window data historis; belum melakukan mutasi pada penyimpanan utama.
6. **Evaluate `specificFailureFH`**: PTS, turbulensi, banyak sampah, Dry Run. Evaluator saling independen; Mathematical Area mengonsumsi window canonical yang telah diurutkan dan dibatasi.
7. **Evaluate `specificFailureVFD`**: unbalance, under/overvoltage, panel overheat. Jalankan juga ketika flowhead tidak tersedia (universal classification).
8. **Apply pure transitions to draft state**: untuk tiap evaluator `ready`: TRUE/FALSE; untuk `not ready`: tahan aktivitas dan increment stagnasi. Gunakan `receivedAt` untuk lifecycle.
9. **Apply OFF policy to draft**: bila detektor OFF terverifikasi dan durasi OFF kontinu `>120000 ms`, terapkan kebijakan reset `activeTroubles`; kebijakan korelasi dengan lifecycle masih `OD-02`.
10. **Derive NORMAL**: setelah state trouble lain final untuk draft, NORMAL aktif jika **tidak ada gangguan aktif** (NULL tidak dianggap aktif). Terapkan transisi NORMAL dan timestamp.
11. **Commit atomic**: jika validasi/evaluator tak terduga gagal, rollback draft **dan timestamp/window/state** sebagai satu unit. Error konfigurasi individual yang dapat direpresentasikan sebagai `not ready` tidak membatalkan gangguan lainnya.
12. **Serialize**: `results` = evaluator ready (ditambah NORMAL sebagai klasifikasi eksplisit sesuai kontrak), `missingData` = evaluator not ready, `activeTroubles` = snapshot state final. Mode `poc` menambah `measurements`; mode `production` tidak. Jangan menyimpan histori episode panjang di engine.

**Concurrency**: walaupun JS event-loop satu thread, `await` resolver dapat menyebabkan dua event pompa yang sama diproses saling mendahului. Antrean/serialisasi **per `pumpId`** harus memastikan gate timestamp dan commit atomik berlangsung satu urutan. Tidak perlu global lock untuk semua pompa.

### Aturan transisi state (harus ditulis sebagai reducer yang diuji)

| Input evaluator | `detected` | `triggerCount` | `stagnationCount` | Lifecycle |
|---|---|---|---|---|
| `ready=true, trigger=1` | true | sebelumnya + 1 | 0 | Bila sebelumnya false: `startAt=receivedAt`, `endAt=null`. Bila tetap true: jangan ubah. |
| `ready=true, trigger=0` | false | 0 | 0 | Bila sebelumnya true: `endAt=receivedAt`. Bila tetap false: jangan ubah episode. |
| `ready=false` dan stagnasi baru < 5 | tahan | tahan | +1 | jangan ubah timestamp. |
| `ready=false` dan stagnasi baru >= 5 | tahan | 0 | 0 | jangan ubah timestamp. |
| Event ditolak gate timestamp | tahan | tahan | tahan | tidak ada mutasi apa pun. |
| OFF kontinu >120 s | reset active troubles | TBD (lihat OD-02) | TBD | TBD (lihat OD-02). |

**Invarian:** `triggerCount` bukan ambang aktivasi dan tidak dibatasi `limitStagnan`. Reset karena stagnasi **tidak** menjadikan `detected=false`. Jika data hilang selamanya, gangguan terakhir tetap aktif kecuali masuk pengecualian OFF 120 detik yang telah terverifikasi atau ada evaluasi valid FALSE. Nilai `stagnationCount` memulai periode baru setelah reset kelima.

### Timeline OFF 120 detik (*strictly greater*)

```text
10:00:00 receivedAt → OFF terverifikasi: offSince = 10:00:00
10:02:00 receivedAt → elapsed = 120000 ms → BELUM reset
10:02:01 receivedAt → elapsed = 121000 ms → reset activeTroubles
10:02:05 receivedAt → OFF tetap berlanjut → jangan bangkitkan episode palsu
10:02:06 receivedAt → RUN terverifikasi → clear offSince
```

Batas ini dihitung dari **dua timestamp `received_at`**. Tidak menerima paket selama 120 detik tidak identik dengan ada bukti OFF selama 120 detik. Jika tidak ada data baru, mesin yang hanya bekerja *on-event* tidak dapat menjalankan timeout tepat waktu; jangan mengarang background timer yang tidak diminta.

### Mathematical Area: kapan window di-update

Tetapkan dan uji urutan pembentukan area (histori sebelum pembacaan sekarang). Untuk turbulensi kode lama membandingkan arus saat ini terhadap 1–30 nilai historis; ukuran window 31 jika memasukkan nilai sekarang untuk pembentukan *trailing evidence*. Jika histori 0 → tidak siap untuk komponen area. Untuk 1–29 histori valid → CMA; untuk >=30 → MA30. Hanya data event yang lolos gate yang bisa mengubah window. Pengisian `null` tidak dihitung sebagai nilai numerik dan tidak mengurangi kestabilan urutan `receivedAt`.

---

## F. Matriks klasifikasi dan pemeriksaan rumus

**Setiap evaluator wajib mempunyai berkas uji independen serta daftar persyaratan data/config.** Tabel berikut berasal dari struktur ZIP dan percakapan; sel berstatus `VERIFY` adalah hal yang belum boleh ditetapkan baru oleh agent.

| Trouble type | Kelompok | Konsep rumus/aturan saat ini | Input minimal / uji wajib |
|---|---|---|---|
| `pompa_tersangkut_sampah` | FH | Kode lama `F<=10` DAN minimal 3 dari 4 (`kW>=ref`, `A>=ref`, `T>=110%`, `RPM>=100`). **VERIFY:** profile memakai `F<10`. | F, kW, A, T, RPM; uji 3/4, 2/4, batas F 10. |
| `turbulensi` | FH | `F<setpoint` AND `kW>=ref` AND `|A_current−MA/CMA_history|>=10 A` AND `T>=90%`. Window 30 historis; **VERIFY** operator akhir dengan spesifikasi. | Setpoint F, powerRef, current history, T; histori 0/1/29/30/31; gap, NULL, sample order. |
| `banyak_sampah` | FH | Existing: `F<=setpoint`, `kW>=ref`, `A>=ref`, `T>=90%` (AND 4/4). | Boundary setiap operator, data/ref tidak lengkap. |
| `dry_run` | FH | `DR_F` frekuensi setpoint dengan pembulatan 2 dp, daya `<=0.667×kWRef`, arus `<=0.64×ARef`, torsi `<70%`, semuanya 4/4 dalam kode ZIP. **VERIFY** persamaan DR_C resmi bila berbeda. | Ref, setpoint, F, kW, A, T; nilai tepat ambang dan rounding .005; NULL. |
| `unbalance` | VFD | Nilai deviasi 3 fasa dan OR ambang `>=10%`; **VERIFY** definisi penyebut dan normalisasi terhadap standar matematika proyek. | Iu/Iv/Iw, nol fasa, near boundary 10%, nilai non-finite. |
| `undervoltage` | VFD | `inputVoltage < 360 V`. | 359.99/360/360.01/NULL. |
| `overvoltage` | VFD | ZIP `inputVoltage > 410 V`; belum ada koreksi user untuk nilai ini. | 409.99/410/410.01/NULL. |
| `panel_overheat` | VFD | `ambient>=60 OR controlBoard>=60 OR inverter>=60`. | Salah satu TRUE, semua FALSE, partial NULL, semua NULL. |
| `normal` | Derived | Aktif jika tidak ada trouble lain dalam `activeTroubles`, termasuk ketika semua evaluator `not ready` dan state trouble lain nonaktif. | semua FALSE, satu TRUE, campuran NULL, semua NULL, transisi dan OFF. |

**Keterbatasan spesifikasi:** kelas tersebut berjumlah **8 gangguan + NORMAL**, sesuai `models.ts`. Jangan menambah kelas kesembilan selain NORMAL hanya karena rangkuman terdahulu menyebut sembilan trouble; kode ZIP memberi daftar yang terverifikasi.

**Tabel readiness:** evaluator harus mengembalikan status siap + 0/1 bila prasyarat persamaan tersedia, atau not-ready + daftar field `missingData`. Tidak ada `reason` naratif. Untuk konfigurasi yang hilang, gunakan path parameter jelas seperti `config.flowhead.powerRefKw`. `NULL` boleh diabaikan hanya untuk derivasi NORMAL, bukan untuk mengisi operand persamaan.

---

## G. Tahapan implementasi untuk AI Agent (dependency gates)

### Phase 0 — Safe Preflight dan pembatasan ruang lingkup

**Input:** ZIP dan checkout repository aktual.  
**Tugas:**
1. Tentukan direktori yang bersesuaian dengan `engine/` dari ZIP menggunakan lokasi berkas nyata. Cetak absolute path serta relative path. Jangan menebak root.
2. `git status --short`, daftar file `engine/`, hash/checksum file target, import graph, versi Node/TypeScript, test runner tersedia. Read-only untuk file di luar scope.
3. Temukan pemanggil `getEngine()`, `classify()`, dan type contracts secara read-only; catat dampak breaking changes tanpa mengedit pemanggil.
4. Buat rollback plan: pastikan baseline bisa dipulihkan (git commit/branch existing bila tersedia); **jangan** menjalankan destructive git reset yang bisa menghapus perubahan user.
5. Catat `DECISION_REQUIRED` dan kondisi yang menghalangi runtime/testing. Jangan menyembunyikan missing module/dependency.

**Output di `engine/docs/`:** `BASELINE_DIFF.md` awal dan `OPEN_DECISIONS.md`.

**Gate P0:** scope benar, audit status kerja tercatat, tidak ada file di luar `engine/` yang dimodifikasi.

### Phase 1 — Characterization tests kode existing

**Tujuan:** mengunci perilaku kode lama untuk mendeteksi *accidental regressions*; tidak menganggap semua perilaku lama benar.

**Tugas:**
1. Buat fixture dan uji output legacy untuk 8 gangguan + NORMAL, tier 500/3000/5000, panel, voltage, unbalance, Dry Run, dan moving average.
2. Catat legacy `matchRule` AND 4/5 dan 5/6, `count_trigger` lama, single `trouble_type`, sampai `READY/NO_MATCH` saat NULL.
3. Periksa `computeTA` dengan 0,1,29,30 nilai **sebelum current**, `freqEq2dp` round-half-up, PTS 3/4.
4. Pisahkan golden outputs legacy vs expected outputs spesifikasi; beri label `INTENTIONAL_CHANGE` untuk multi-label, NULL/readiness, immediate activation, lifecycle, naming, dll.
5. Bila repo tidak dapat dieksekusi karena dependensi di luar ZIP, nyatakan `BLOCKED_RUNTIME`; lanjutkan static tests untuk fungsi yang dapat diuji tanpa mengedit luar scope.

**Gate P1:** paling tidak satu baseline testcase per trouble, laporan beda legacy/spesifikasi, tidak ada perubahan perilaku tanpa catatan.

### Phase 2 — Canonical input + typed config

**File utama:** `models.ts`, `telemetry.ts` (baru), `configuration.ts` (baru), `configuration-resolver.ts`, mungkin `profiles.ts`/`setpoints.ts` sebagai adapter migrasi.

**Tugas:**
1. Definisikan kontrak raw payload, `CanonicalTelemetry`, `EquipmentIdentity`, `ClassificationConfig`, `Evaluation` discriminated union, `TroubleResult` dan output.
2. Normalisasi finite numeric string/number; tidak zero-fill; parse boolean string secara eksplisit; timestamp `received_at` strict.
3. Buat tabel mapping alias terverifikasi; field ambigu **jangan** fallback otomatis.
4. Resolve referensi dari nilai injection/dokumen legacy saat fixture, dengan prioritas existing `override→flowhead→profile` **sebagai baseline** sampai spesifikasi override DB jelas. Jangan query DB di evaluator.
5. Validasi threshold positif/finite yang diwajibkan serta `null` sebagai missing config; gunakan validasi manual/type guards atau library yang sudah terpasang — **jangan memodifikasi dependency manifest**.
6. Implementasi `flowhead`, `flowheadId`, `vsdTypeId` untuk resolver universal tanpa whitelist support.

**Gate P2:** tests parse angka `0`, `"0"`, `"0.00"`, `null`, `""`, `NaN`, `Infinity`, boolean `"false"`, timezone dan invalid timestamp; semua lulus. No hidden fallback antarfield ambigu.

### Phase 3 — Pure mathematics & evaluators

**File:** `mathematics/*`, `evaluators/*`, `evaluator.ts`, `support.ts`.

**Tugas:**
1. Pindahkan rumus dasar ke pure functions berparameter bernama, tanpa string operator interpreter atau akses Map.
2. Evaluator per trouble mengembalikan `Evaluation` (`ready=true` 0/1 + measurements, atau `ready=false` + missingData) dan **tidak memutasi state**.
3. Pertahankan dua kategori group `specificFailureFH` / `specificFailureVFD` hanya sebagai organisasi domain, bukan filtering equipment.
4. Implementasikan OR/AND/threshold langsung dalam TS. Hilangkan *almost AND* implisit; PTS 3/4 diprogram secara eksplisit sesuai rumus PTS, bukan mengubah arti global operator AND.
5. Dry Run: gunakan nama variabel `drFrequency`, `drPowerThreshold`, `drCurrentThreshold`, `drTorqueThreshold`, `drCondition`; pembandingan frekuensi 2dp round-half-up jika itu spesifikasi yang berlaku. Jangan ketik default referensi 75/157 ketika DB/typed config tidak menyediakan nilai yang wajib.
6. Turbulensi: kelola perhitungan MA/CMA sesuai jumlah histori dan `received_at` yang berurutan; tidak menghitung current ke baseline current.
7. NORMAL **tidak** dievaluasi bersama evaluator sensor; derivasi setelah state per trouble diperbarui.
8. Hadapkan konflik matematis ke dokumen `FORMULA_MATRIX.md` dan `OPEN_DECISIONS.md`; jangan putuskan sendiri.

**Gate P3:** semua evaluator lulus boundary, NULL, dan matematika; tidak ada akses DB/Socket.IO/file dari evaluator; tidak ada generator ekspresi JSON dinamis.

### Phase 4 — Bounded Mathematical Area & event-time gate

**File:** `state/window.ts`, `mathematics/moving-average.ts`, `evidence.ts`, `engine.ts`.

**Tugas:**
1. Kunci `receivedAt` strictly increasing per pompa, dengan timestamp numerik dan format serialisasi yang konsisten.
2. Gunakan bounded history per `pumpId + metric`. Turbulensi maksimal 30 historical currents, plus current yang sedang dievaluasi secara terpisah (kompatibel dengan effective 31 dari legacy).
3. Jadikan histori berdasarkan event valid, bukannya kedatangan async resolver; thread/concurrency gate per pompa.
4. Pastikan satu metric/window reusable; jangan menyalin semua histori per evaluator.
5. Audit kebijakan gap 10 detik existing; pertahankan sebagai controlled option/karakterisasi sampai OD-07 diputuskan.

**Gate P4:** 0/1/29/30/31 samples tepat, duplikat/out-of-order tidak mengubah angka/penghitung, dua pompa tidak bertukar sample.

### Phase 5 — State Manager, lifecycle, stagnation & NORMAL

**File:** `state/manager.ts`, `state/transition.ts`, `evaluators/normal.ts`, `engine.ts`.

**Tugas:**
1. Bentuk key state internal `pumpId → troubleType` (identitas pompa untuk isolasi; keputusan pengguna bahwa penghitung *per trouble type* tetap terjaga pada tiap konteks pompa).
2. Implementasi reducer dengan matriks transisi bagian E; state default kosong → semua `detected=false`, counter=0, timestamp=null.
3. Setelah `trigger=1`, aktif langsung, dan `triggerCount` increment; `trigger=0` nonaktif, counter reset; `not ready` hold aktivitas, stagnasi increment. Batas stagnasi 5 reset kedua counter **tanpa** mengubah aktivitas dan lifecycle.
4. Bentuk `activeTroubles` dari state manager, bukan dari `results` terbaru.
5. Implementasi NORMAL sebagai derived classification ber-lifecycle; NORMAL aktif bila tak ada gangguan lain yang aktif, termasuk apabila semua telemetry not ready.
6. Tambahkan OFF duration tracking berbasiskan `receivedAt` dan port `isPumpOff` **tanpa mengarang mapping input OFF**. Kebijakan penutupan episode setelah 120 s aktifkan hanya setelah OD-01/OD-02 ditetapkan.
7. Uji tidak ada kebocoran state antar-pompa dan per-trouble; reset stagnasi tidak mengganti `endAt`.

**Gate P5:** state transition table lulus, OFF >120 s teruji menggunakan sinyal OFF fixture yang eksplisit, dan tidak ada kemunculan *phantom trouble* setelah reset.

### Phase 6 — Atomic orchestration & API façade internal

**File:** `engine.ts`, `service.ts`, `models.ts`.

**Tugas:**
1. `engine.ts` hanya normalisasi/validasi → resolve snapshot config → evaluasi seluruh trouble → reducer draft → NORMAL → atomic commit → serializer.
2. Untuk each event `pumpId`, serialisasikan update (mutex/queue ringan, tidak perlu dependency eksternal). Pastikan exception pada satu evaluator tidak meninggalkan state setengah berubah.
3. Tangani ketidaksiapan individual sebagai output `missingData`, bukan fatal error. Fatal error hanya untuk input envelope/config fatal yang tidak dapat ditangani dengan aman.
4. Jadikan `service.ts` facade pembuatan engine dan injeksi resolver/clock/off-detector; tidak ada DB langsung.
5. Migrasikan/hapus `matchRule`, `updateTriggerCounter` legacy dan `RuleNameToTroubleType` interpreter bila tidak diperlukan. Jangan menghapus dead helper sebelum static import/export search dan tes.
6. Keluaran tidak lagi memilih `rules_match[0]`. Semua gangguan dapat aktif serentak.

**Gate P6:** uji error injection saat evaluator ke-N gagal, event ke-N+1 tetap konsisten; perubahan di luar `engine/` nol.

### Phase 7 — Output serializer PoC/production

**File:** `output/serializer.ts`, `models.ts`, `__tests__/output-contract.test.ts`.

**Tugas:**
1. `results`: hanya item klasifikasi ready, termasuk yang `detected=false`; `missingData`: keyed per trouble yang not ready, tanpa `reason`.
2. `activeTroubles`: state aktivitas terakhir; NULL tidak menghapus yang aktif.
3. `startAt` dan `endAt` menggunakan timestamp valid dari payload `received_at` dan hanya transisi aktivitas, kecuali kebijakan OFF yang disahkan.
4. `measurements` ada hanya di PoC; pada production properti benar-benar tidak ada (bukan `null`, `{}`, atau field bernama `evidence`).
5. Pastikan kedua mode memberi detected/counter/lifecycle yang identik pada input dan state yang sama.
6. Dokumentasikan breaking changes terhadap pemanggil existing untuk implementasi terpisah di luar scope.

**Gate P7:** snapshot tests kedua mode lulus; JSON production minimal, tanpa `measurements` ataupun field tak terpakai.

### Phase 8 — Verification, 5R audit, delivery

**Tugas:**
1. Jalankan seluruh tes yang tersedia; typecheck memakai toolchain repository tanpa memodifikasi file di luar `engine/`.
2. Lakukan *differential regression* antara output legacy dan baru. Semua beda harus dikelompokkan `EXPECTED_SPEC_CHANGE`, `BUG_FIXED_BY_SPEC`, atau `UNRESOLVED`.
3. Static audit: `as unknown as Record`, `any` tanpa alasan, hidden fallbacks, unbounded arrays, query DB di evaluator, output `evidence`, `first match`, `AND 4/5 generic`, string `"false"` truthiness, dan side-effects.
4. Pastikan tidak ada perubahan file di luar `engine/` dengan `git diff --name-only` / audit yang setara. Jangan mengubah root configs.
5. Perbarui `engine/docs/IMPLEMENTATION_REPORT.md`, `BASELINE_DIFF.md`, `FORMULA_MATRIX.md`, `OPEN_DECISIONS.md`. Laporkan file yang ditambah/diganti/dihapus, tes dan hasil, kekurangan, kontrak baru, serta OD yang membutuhkan pemilik domain.
6. Bila OD masih terbuka, rilis modul/fitur yang sudah pasti dan tandai OFF/config/math ambigu sebagai `NOT_PRODUCTION_READY` daripada mengklaim pekerjaan seluruhnya selesai.

**Gate P8 / Definition of Done:** seluruh kriteria penerimaan bagian H tercapai dan perbedaan spesifikasi matematika yang material memiliki keputusan pemilik domain. Jangan langsung mengubah proses prod atau mengirim deployment.

---

## H. Test matrix wajib dan acceptance criteria

| ID | Skenario | Ekspektasi wajib |
|---|---|---|
| T01 | Dua trouble TRUE bersamaan | Keduanya muncul dan aktif, tanpa pemilihan primary trouble. |
| T02 | Satu evaluator missing, yang lain ready | Hanya yang ready di `results`; yang missing di `missingData`; evaluator lain tetap jalan. |
| T03 | Semua gangguan NULL dan state awal kosong | `normal` aktif; tidak ada zero-fill; `missingData` gangguan tetap tersedia. |
| T04 | Trouble aktif → 1–4 eval not ready | Trouble tetap di `activeTroubles`, lifecycle unchanged; stagnation meningkat. |
| T05 | Trouble aktif → eval not ready ke-5 | Dua counter reset; `detected/startAt/endAt` tidak berubah. |
| T06 | Setelah stagnasi ke-5, satu lagi NULL | `stagnationCount=1` periode baru, active state tetap. |
| T07 | TRUE/TRUE/FALSE/TRUE | `triggerCount`: 1/2/0/1; dua episode dengan startAt berbeda. |
| T08 | TRUE terus melewati 5 | `triggerCount` 1..6..n, tidak dibatasi limitStagnan. |
| T09 | Multiple pumps | Window dan state tidak tercampur. |
| T10 | Duplikat `received_at` / out-of-order | Event ignored, tidak ada perubahan counter/window/lifecycle. |
| T11 | Mathematical Area historis 0/1/29/30/31 | 0 not ready; 1–29 CMA; ≥30 MA30 berbasis 30 historical terbaru. |
| T12 | String kosong dan `"abc"` pada numerik | Invalid/missing; tidak menjadi 0 atau angka palsu. |
| T13 | `"0"`, `"0.00"`, `0` | Valid numerik nol, tidak dianggap NULL. |
| T14 | `"false"` pada field boolean | False, bukan truthy string. |
| T15 | Input NULL setelah trouble aktif | Di `missingData`, tidak dalam `results`, tetapi trouble tetap di `activeTroubles`. |
| T16 | `received_at` beda >120s selama OFF **terverifikasi** | `activeTroubles` reset; konsistensi lifecycle mengikuti OD-02. |
| T17 | OFF tepat 120000 ms | Belum reset; strictly `>120s`. |
| T18 | Status bukan OFF / makna status unknown | Jangan paksa reset atau mengasumsikan `status:"0"` sebagai OFF. |
| T19 | Perubahan ref snapshot pada event berikutnya | Tidak retroaktif; satu event memakai satu snapshot config. |
| T20 | PoC vs production pada state/input sama | Sama detected, timestamp, count; hanya PoC punya `measurements`. |
| T21 | Error saat evaluator/commit draft | Seluruh perubahan event rollback termasuk lastAccepted timestamp; event berikutnya dapat diproses. |
| T22 | Boundary UV | `359.99` true, `360` false, `360.01` false. |
| T23 | Boundary OV dari ZIP | `410` false, `410.01` true (jika nilai `410` disetujui). |
| T24 | Panel OR | Satu dari tiga suhu melebihi ambang → TRUE; semua missing → missingData, NORMAL sesuai state. |
| T25 | PTS 3/4 | 3 true + frekuensi lolos → TRUE; 2/4 → FALSE; boundary 10 Hz ditahan sampai OD-08. |
| T26 | Dry Run | 0.667/0.64, torsi `<70`, frekuensi pembulatan 2dp, referensi invalid, NULL. |
| T27 | Unbalance | 3 fasa +0/null dan ambang 10%; penyebut final sesuai keputusan matematika OD-08. |
| T28 | Turbulensi | Current dibandingkan dengan MA/CMA historis, bukan baseline berisi current. |
| T29 | NORMAL lifecycle | Aktif pertama, tutup saat trouble aktif, buka episode baru ketika semua trouble tak aktif. |
| T30 | Scope | 100% perubahan hanya di `engine/`; tidak ada perubahan provider DB/API/Socket.IO/root manifest. |

### Kriteria penerimaan akhir

- [ ] Semua klasifikasi existing (8 trouble + NORMAL) tersedia dan ditulis sebagai fungsi matematis independen.
- [ ] *Fully Procedural*, tanpa *generic rules interpreter* pada jalur utama.
- [ ] Config typed siap diinjeksi dari middleware/DB tanpa query DB langsung dalam evaluator.
- [ ] Multi-label, immediate activation, readiness per trouble, `results`/`missingData`/`activeTroubles` sesuai keputusan.
- [ ] Bounded Mathematical Area berdasarkan event-time `received_at`; strict ordering dan isolasi state per pompa.
- [ ] Trigger/stagnation sesuai tabel transisi; NORMAL merupakan klasifikasi dengan lifecycle.
- [ ] OFF >120s memiliki kontrak deteksi dan kebijakan lifecycle yang disetujui; jangan mengklaim ini lulus bila OD-01/OD-02 masih terbuka.
- [ ] PoC `measurements`, production tanpa `measurements`; nama `evidence` tidak dipakai pada output baru.
- [ ] Tes threshold/boundary dan regression lulus; formula berbeda legacy vs spesifikasi di-review terpisah.
- [ ] Tidak menambahkan version tracking matematika terpisah.
- [ ] Tidak menulis apa pun di luar `engine/`, dan tidak melakukan deployment.

---

## I. Teknik 5R yang diterapkan secara terkendali

| 5R | Fokus | Ketentuan |
|---|---|---|
| **Remove** | `first-match`, trigger gating legacy, helper tidak dipakai, pengecekan duplikat, fallback yang tidak sah | Hapus **setelah** tersedia karakterisasi atau alasan spesifikasi, bukan hanya karena terlihat redundan. |
| **Replace** | Unsafe casting, raw `Number` coercion, string-numeric/boolean parsing, implicit AND | Pakai discriminated union, parser ketat, named constants/typed config, ekspresi matematis eksplisit. |
| **Refactor** | `evaluateTierRules` god function, state bercampur evaluasi, serialisasi bersatu dengan perhitungan | Evaluator murni + State Manager + Orchestrator + Serializer. |
| **Rename** | Internal Pythonic snake_case dan nama ambigu | `pumpId`, `receivedAt`, `triggerCount`, `stagnationCount`, `measurements`; raw payload tetap terbaca apa adanya oleh adapter. |
| **Right-size** | Redundansi tier JSON, history tak terbatas, class/pattern berlebihan | Konfigurasi reference-only dari DB, bounded windows, modul sekecil perlu, satu engine universal. |

**Non-goals:** merombak database/schema, menulis Socket.IO handler, mengganti message broker, refactor seluruh repository, memilih primary trouble, membuat engine kedua, mengganti klasifikasi dengan LLM, menulis ulang rumus tanpa persetujuan, atau deployment.

---

## J. Prompt eksekusi untuk AI Coding Agent

Salin bagian berikut kepada agen sebagai instruksi implementasi, bersama file ZIP dan Decision Register di atas:

> **ROLE:** Senior TypeScript Engineer dan Domain Verification Engineer untuk DEXMIN Classification.  
> **SCOPE:** Hanya direktori `engine/` yang setara dengan isi `engine.zip`.  
> **GOAL:** Laksanakan Phase 0–8 dalam `DEXMIN_Classification_Engine_Implementation_Plan.md` secara berurutan.  
> **SOURCE OF TRUTH:** Persamaan matematika DEXMIN yang telah disahkan dan Decision Register. `rules.json`/Python port bukan sumber kebenaran jika bertentangan dengan keputusan pengguna.  
> **REQUIREMENTS:** Fully procedural, evaluator per trouble independen, universal classification, multi-label, per-trouble readiness, `results` ready only, `missingData` terpisah tanpa narasi, `activeTroubles` dari State Manager, NORMAL eksplisit, `received_at` strictly increasing, bounded Mathematical Area, immediate activation, trigger/stagnation lifecycle, PoC `measurements` dan production minimal. OFF >120 detik berdasarkan `received_at` harus mengikuti keputusan pengguna; jangan membuat mapping OFF tanpa data pendukung.  
> **SAFETY:** Jangan edit file apa pun di luar `engine/`, termasuk root project, util, API, DB, Socket.IO, dependency manifest. Dilarang menjalankan migration/deployment. Semua konflik spesifikasi diberi `DECISION_REQUIRED` dan kasus uji batasnya. Lakukan rollback hanya pada perubahan yang Anda buat, jangan reset pekerjaan orang lain.  
> **PROCESS:** Awali setiap fase dengan daftar file target dan precheck; lakukan patch seminimal mungkin; jalankan unit/integration regression; cetak laporan `PASS/FAIL/BLOCKED`; simpan bukti di `engine/docs/`. Bila sebuah gate gagal, jangan lanjut ke fase yang bergantung padanya.  
> **DELIVER:** Patch source, tes `engine/__tests__/`, dokumentasi `engine/docs/`, matriks perubahan legacy-vs-spec, penjelasan semua keputusan terbuka, dan audit akhir file yang diubah.  
> **STOP CONDITION:** Jangan menyatakan `PRODUCTION READY` jika pemetaan OFF, perilaku reset episode, boundary matematika, atau kontrak waktu masih membutuhkan keputusan. Jangan memodifikasi file lain untuk 'membuat tes hijau'.

---

## K. Ringkasan keputusan yang tidak boleh salah dipahami

1. **`limitStagnan = 5` adalah limit `stagnationCount`, bukan `triggerCount`.**
2. **`triggerCount` naik setiap TRUE, reset saat FALSE, hold saat missing; bisa melebihi 5.**
3. **Saat stagnasi mencapai 5, kedua counter reset, tetapi gangguan yang telah aktif tetap aktif.**
4. **NULL diabaikan hanya untuk derivasi NORMAL; tidak boleh diubah menjadi 0 untuk rumus sensor.**
5. **Saat terdeteksi OFF kontinu >120 detik berdasarkan `received_at`, aktivitas lama harus dibersihkan — detail transisi episode memerlukan keputusan.**
6. **PoC menggunakan `measurements`; production tidak menyertakan `measurements`.**
7. **Semua perubahan kode dan tes tetap berada di `engine/` — bukan middleware ataupun seluruh repository.**
8. **Tidak ada versi spesifikasi matematika tersendiri.**
