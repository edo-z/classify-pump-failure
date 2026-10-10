import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "./components/Sidebar";

export const metadata: Metadata = {
  title: "Pump Classification",
  description: "Pump Classification Prototype / PoC",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body>
        <div className="app-shell">
          <Sidebar />
          <div className="content">
            <main>{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
