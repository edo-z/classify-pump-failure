import { test, expect } from 'e2e';
import { z } from 'zod';

// 5S = Seiri/Ringkas, Seiton/Rapi, Seiso/Resik, Seiketsu/Rajin, Shitsuke/Rawat.
// Pola: 1 agent.act (tugas wajar) -> expect keras (fakta) -> agent.extract
// (penilaian kualitatif terstruktur). Extract bukan vonis mutlak: selalu
// dibaca bersama expect di atasnya.
const FiveS = z.object({
  seiri_ringkas: z.string(),
  seiton_rapi: z.string(),
  seiso_resik: z.string(),
  seiketsu_rajin: z.string(),
  shitsuke_rawat: z.string(),
  temuan: z.array(z.string()),
});

test(
  '5s: /documents ringkas-rapi-resik',
  { tags: ['5s'] },
  async ({ app, screen, agent }) => {
    await app.open('/documents');
    await agent.act(
      'pilih dokumen "aldo_pump_logs_2.csv" dari dropdown dokumen lalu klik tombol "Analisis File Ini"',
    );
    await expect(screen.getByText('Data siap dianalisis.')).toBeVisible();
    const nilai = await agent.extract(
      'nilai 5S halaman documents: seiri (ada UI mati/duplikat?), seiton (label konsisten?), seiso (bersih dari teks sisa/error?), seiketsu (validasi & format konsisten?), shitsuke (status/audit terlihat?). Satu kalimat per aspek. Temuan HANYA berisi masalah nyata yang kamu lihat (mis. label ganda, tombol mati, teks error); [] bila nihil. JANGAN salin isi layar.',
      { schema: FiveS },
    );
    // Gerbang = expect keras di atas. Penilaian dicatat untuk triase manusia
    // (lihat docs/15 §6): vonis kualitatif model tidak boleh menggagalkan run.
    console.log('5S /documents: ' + JSON.stringify(nilai));
    expect(nilai.seiri_ringkas.length).toBeGreaterThan(0);
  },
);

test(
  '5s: /chat rajin-rawat (disiplin + keberlanjutan)',
  { tags: ['5s'] },
  async ({ app, screen, agent }) => {
    await app.open('/chat');
    await agent.act('isi kotak pesan dengan teks "halo" lalu klik Kirim');
    await expect(screen.getByText('halo')).toBeVisible();
    const nilai = await agent.extract(
      'nilai seiketsu (disiplin: validasi input, status kirim jelas?) dan shitsuke (rawat: riwayat/status terlihat, siap dipakai ulang?) halaman chat. Satu kalimat per aspek. Temuan HANYA berisi masalah nyata yang kamu lihat; [] bila nihil. JANGAN salin isi layar.',
      {
        schema: z.object({
          seiketsu_rajin: z.string(),
          shitsuke_rawat: z.string(),
          temuan: z.array(z.string()),
        }),
      },
    );
    console.log('5S /chat: ' + JSON.stringify(nilai));
    expect(nilai.seiketsu_rajin.length).toBeGreaterThan(0);
  },
);
