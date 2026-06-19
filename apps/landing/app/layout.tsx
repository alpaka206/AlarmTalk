import type { Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#FAF9F5",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="bg-aurora min-h-screen">
        <div className="grain" aria-hidden="true" />
        <div className="bg-grid pointer-events-none absolute inset-x-0 top-0 -z-0 h-[640px]" />
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
