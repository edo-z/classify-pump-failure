"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/documents", label: "Klasifikasi Dokumen", desc: "Batch & Scan", icon: "📄" },
  { href: "/chat", label: "Chat Asisten", desc: "Dexmin SSE", icon: "D" },
  { href: "/admin", label: "Admin Setpoint", desc: "Konfigurasi", icon: "⚙" },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div style={{ fontWeight: 800, fontSize: "1rem" }}>
          Pump Classification <span style={{ fontWeight: 400, color: "#6b7280" }}>PoC</span>
        </div>
        <div style={{ fontSize: "0.7rem", color: "#6b7280", marginTop: "0.25rem" }}>Batch • Asisten • Admin</div>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section-label">Analisis</div>
        {navItems.slice(0, 2).map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          // 5R Tanpa-ikon: item chat memakai monogram lingkaran agar sejajar
          // dengan ikon menu lain tanpa menambah keluarga ikon baru.
          const mono = item.icon.length === 1;
          return (
            <Link key={item.href} href={item.href} className={`nav-item ${active ? "active" : ""}`}>
              {mono ? (
                <span className="nav-mono" aria-hidden="true">{item.icon}</span>
              ) : (
                <span style={{ fontSize: "1.1rem" }}>{item.icon}</span>
              )}
              <span>
                {item.label}
                <small style={{ display: "block", color: "#6b7280", fontWeight: 400, fontSize: "0.75rem" }}>{item.desc}</small>
              </span>
            </Link>
          );
        })}

        <div className="nav-section-label">Konfigurasi</div>
        {navItems.slice(2).map((item) => {
          const active = pathname === item.href;
          return (
            <Link key={item.href} href={item.href} className={`nav-item ${active ? "active" : ""}`}>
              <span style={{ fontSize: "1.1rem" }}>{item.icon}</span>
              <span>{item.label}<small style={{ display: "block", color: "#6b7280", fontWeight: 400, fontSize: "0.75rem" }}>{item.desc}</small></span>
            </Link>
          );
        })}
      </nav>

      <div style={{ marginTop: "auto", padding: "1rem", fontSize: "0.7rem", color: "#9ca3af", borderTop: "1px solid #f3f4f6" }}>
        <div>Predic • Pump PoC</div>
        <div>v0.1 • {new Date().getFullYear()}</div>
      </div>
    </aside>
  );
}
