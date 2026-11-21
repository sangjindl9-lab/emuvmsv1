import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EUM BMS PRO (이음BMS) — 통합 전력제어·원격검침",
  description: "빌딩·아파트·산업시설 통합 전력제어 및 원격검침 플랫폼 EUMBMS",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#071019",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
