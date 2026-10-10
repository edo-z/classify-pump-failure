// 5R Rapi — label sinyal terpusat, sumber tunggal dipakai chart dokumen.

export function troubleDescription(troubleType: string) {
  switch (troubleType.toLowerCase()) {
    case "undervoltage":
      return "Tegangan masuk terindikasi rendah.";
    case "overvoltage":
      return "Tegangan masuk terindikasi tinggi.";
    case "unbalance":
      return "Terdeteksi ketidakseimbangan arus antar fasa.";
    case "panel_overheat":
      return "Temperatur panel atau perangkat VSD terindikasi tinggi.";
    case "pompa_tersangkut_sampah":
      return "Pompa terindikasi mengalami hambatan atau tersangkut sampah.";
    case "turbulensi":
      return "Kondisi operasi pompa menunjukkan indikasi aliran yang tidak stabil.";
    case "banyak_sampah":
      return "Kondisi operasi menunjukkan indikasi beban akibat sampah.";
    case "dry_run":
    case "low_water_menyala":
      return "Pompa tetap beroperasi pada kondisi yang mengindikasikan level air rendah.";
    case "normal":
      return "Tidak ditemukan indikasi gangguan berdasarkan data yang dianalisis.";
    default:
      return "Indikasi terdeteksi berdasarkan data yang dianalisis.";
  }
}

export function technicalLabel(value: string) {
  return value.toUpperCase();
}

export function numericSnapshot(
  snapshot: Record<string, unknown>,
  key: string,
) {
  const value = snapshot[key];
  return typeof value === "number" ? value : null;
}
