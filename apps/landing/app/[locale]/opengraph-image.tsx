import { ImageResponse } from "next/og";
import { routing } from "@/i18n/routing";

export const dynamic = "force-static";
export const alt = "Waker — wake up to a voice you love";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "80px",
          backgroundColor: "#090A0F",
          backgroundImage:
            "radial-gradient(circle at 18% 22%, rgba(168,212,255,0.18), transparent 38%), radial-gradient(circle at 82% 18%, rgba(26,18,72,0.6), transparent 42%)",
          color: "#F7F7FA",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 64 64"
            width="56"
            height="56"
          >
            <rect width="64" height="64" rx="14" fill="#1A1248" />
            <rect x="11" y="22" width="4" height="20" rx="2" fill="#F2934A" />
            <rect x="49" y="22" width="4" height="20" rx="2" fill="#F2934A" />
            <rect x="19" y="26" width="3" height="12" rx="1.5" fill="#FFF8EE" />
            <rect x="24" y="22" width="3" height="20" rx="1.5" fill="#FFF8EE" />
            <rect x="29" y="18" width="3" height="28" rx="1.5" fill="#FFF8EE" />
            <rect x="34" y="22" width="3" height="20" rx="1.5" fill="#FFF8EE" />
            <rect x="39" y="26" width="3" height="12" rx="1.5" fill="#FFF8EE" />
          </svg>
          <div style={{ display: "flex", fontSize: 32, fontWeight: 700 }}>
            Waker
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              display: "flex",
              fontSize: 92,
              fontWeight: 700,
              letterSpacing: "-0.025em",
              lineHeight: 1.05,
            }}
          >
            Wake up to a voice
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 92,
              fontWeight: 700,
              letterSpacing: "-0.025em",
              lineHeight: 1.05,
              gap: 18,
            }}
          >
            <span>you</span>
            <span style={{ color: "#A8D4FF" }}>love</span>
            <span>.</span>
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 28,
              color: "#A8AEBA",
              marginTop: 16,
            }}
          >
            Voice alarm · My voice · Shared · Translated
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
