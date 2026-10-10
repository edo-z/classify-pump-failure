// 5R Rapi — tabel area kegagalan, diekstrak dari documents/page.tsx.
// Murni presentasional: data + callback lewat props.

import type { FailureArea } from "../lib/replay/types";
import { FAILURE_COLORS, UNKNOWN_FAILURE_COLOR } from "../lib/replay/constants";

// F14 riset: badge teks gelap + dot warna (kontras AA; dulu teks berwarna
// di atas tint ~13% yang di bawah ambang untuk lime/pink/hijau).
function badgeDot(troubleType: string) {
  const color = FAILURE_COLORS[troubleType] ?? UNKNOWN_FAILURE_COLOR;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: 999,
          background: color,
          display: "inline-block",
          flexShrink: 0,
        }}
      />
      <span style={{ color: "#111827", fontSize: "0.75rem", fontWeight: 700 }}>
        {troubleType.toUpperCase()}
      </span>
    </span>
  );
}

function durationLabel(ms: number) {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec} dtk`;
  const min = Math.round(sec / 60);
  return min < 60 ? `${min} mnt` : `${(min / 60).toFixed(1)} jam`;
}

type Props = {
  areas: FailureArea[];
  visibleCount: number;
  rangeLabel: string | undefined;
  onZoomArea: (start: string, end: string) => void;
  onScrollNearBottom: () => void;
  onLoadMore: () => void;
};

export default function FailureTable({
  areas,
  visibleCount,
  rangeLabel,
  onZoomArea,
  onScrollNearBottom,
  onLoadMore,
}: Props) {
  return (
    <div
      onScroll={(e) => {
        const el = e.currentTarget;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
          onScrollNearBottom();
        }
      }}
      style={{ maxHeight: 380, overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: 8 }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
        <thead style={{ position: "sticky", top: 0, background: "#f9fafb", fontSize: "0.7rem", textTransform: "uppercase", color: "#6b7280" }}>
          <tr>
            <th style={{ textAlign: "left", padding: "0.5rem 0.75rem" }}>Mulai</th>
            <th style={{ textAlign: "left", padding: "0.5rem" }}>Selesai</th>
            <th style={{ textAlign: "left", padding: "0.5rem" }}>Durasi</th>
            <th style={{ textAlign: "left", padding: "0.5rem" }}>Tipe</th>
            <th style={{ textAlign: "right", padding: "0.5rem" }}>Titik</th>
            <th style={{ textAlign: "left", padding: "0.5rem" }}>Zoom</th>
          </tr>
        </thead>
        <tbody>
          {areas.slice(0, visibleCount).map((area) => {
            const durLabel = durationLabel(area.durationMs);
            return (
            <tr key={`${area.trouble_type}-${area.start}-${area.end}`} style={{ borderTop: "1px solid #f3f4f6" }}>
              <td style={{ padding: "0.45rem 0.75rem", whiteSpace: "nowrap" }}>{new Date(area.start).toLocaleString("id-ID")}</td>
              <td style={{ padding: "0.45rem", whiteSpace: "nowrap" }}>{new Date(area.end).toLocaleString("id-ID")}</td>
              <td style={{ padding: "0.45rem", whiteSpace: "nowrap" }}>{durLabel}</td>
              <td style={{ padding: "0.45rem" }}>{badgeDot(area.trouble_type)}</td>
              <td style={{ textAlign: "right", padding: "0.45rem" }}>{area.count}</td>
              <td style={{ padding: "0.45rem" }}>
                <button
                  type="button"
                  onClick={() => onZoomArea(area.start, area.end)}
                  style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", borderRadius: 6, border: "1px solid #d1d5db", background: "white", cursor: "pointer" }}
                >
                  Zoom
                </button>
              </td>
            </tr>
          );
          })}
        </tbody>
      </table>
      <div style={{ padding: "0.5rem 0.75rem", fontSize: "0.75rem", color: "#6b7280", display: "flex", justifyContent: "space-between", borderTop: "1px solid #f3f4f6", background: "#f9fafb" }}>
        <span>
          {Math.min(visibleCount, areas.length)} / {areas.length} area dalam {rangeLabel}
        </span>
        {visibleCount < areas.length && (
          <button
            type="button"
            onClick={onLoadMore}
            style={{ fontSize: "0.7rem", padding: "0.2rem 0.5rem", borderRadius: 6, border: "1px solid #d1d5db", background: "white", cursor: "pointer" }}
          >
            Muat 100 lagi
          </button>
        )}
      </div>
    </div>
  );
}
