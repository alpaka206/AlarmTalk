import type { Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  // 브라우저 UI 색. 페이지 바닥과 같아야 스크롤 끝에서 이음매가 안 보인다.
  themeColor: "#FFFFFF",
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
      {/* 깊이는 여백과 아주 얕은 섹션 배경 단차가 만든다. 방사형 워시·격자·그레인은
          전부 걷었다 — 표면에 무늬가 있으면 그 위에 놓인 제품 화면이 같이 지저분해진다.
          그 자리는 이제 실제 앱 스크린샷이 가져간다. */}
      <body className="bg-bg min-h-screen">
        {/* No-JS safety net: motion primitives bake their hidden initial state into
            the static HTML; without JS this forces every revealed element visible. */}
        <noscript>
          <style>{`[data-reveal]{opacity:1!important;transform:none!important;clip-path:none!important;filter:none!important}`}</style>
        </noscript>
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
