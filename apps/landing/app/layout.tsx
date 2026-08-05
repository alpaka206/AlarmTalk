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
      {/* 깊이는 여백과 섹션 배경 단차가 만든다. 페이지에 깔던 파란 방사형 워시와
          상단 격자는 걷었다 — 페이퍼 위의 파란 후광은 종이가 아니라 화면처럼 보이게
          하고, 그 자리는 이제 실제 앱 스크린샷이 가져간다. 그레인은 남긴다(종이 질감). */}
      <body className="bg-bg min-h-screen">
        {/* No-JS safety net: motion primitives bake their hidden initial state into
            the static HTML; without JS this forces every revealed element visible. */}
        <noscript>
          <style>{`[data-reveal]{opacity:1!important;transform:none!important;clip-path:none!important;filter:none!important}`}</style>
        </noscript>
        <div className="grain" aria-hidden="true" />
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
