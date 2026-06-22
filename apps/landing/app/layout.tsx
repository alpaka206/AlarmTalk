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
        {/* No-JS safety net: motion primitives bake their hidden initial state into
            the static HTML; without JS this forces every revealed element visible. */}
        <noscript>
          <style>{`[data-reveal]{opacity:1!important;transform:none!important;clip-path:none!important;filter:none!important}`}</style>
        </noscript>
        <div className="grain" aria-hidden="true" />
        <div className="bg-grid pointer-events-none absolute inset-x-0 top-0 -z-0 h-[640px]" />
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
