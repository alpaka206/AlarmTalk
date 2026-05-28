import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { routing } from "@/i18n/routing";

export const dynamic = "force-static";
export const alt = "AlarmTalk — wake up to a voice you love";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

async function getMobileDataUri() {
  const buffer = await readFile(
    join(process.cwd(), "public", "og-source.jpeg"),
  );
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

export default async function OpengraphImage() {
  const mobileSrc = await getMobileDataUri();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "row",
          padding: "64px",
          backgroundColor: "#090A0F",
          backgroundImage:
            "radial-gradient(circle at 14% 22%, rgba(168,212,255,0.18), transparent 42%), radial-gradient(circle at 86% 20%, rgba(26,18,72,0.55), transparent 46%)",
          color: "#F7F7FA",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            paddingRight: "32px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 64 64"
              width="48"
              height="48"
            >
              <rect width="64" height="64" rx="14" fill="#1A1248" />
              <rect x="11" y="22" width="4" height="20" rx="2" fill="#F2934A" />
              <rect x="49" y="22" width="4" height="20" rx="2" fill="#F2934A" />
              <rect x="19" y="26" width="3" height="12" rx="1.5" fill="#FFF8EE" />
              <rect x="24" y="22" width="3" height="20" rx="1.5" fill="#FFF8EE" />
              <rect x="29" y="18" width="3" height="28" rx="1.5" fill="#FFF8EE" />
              <rect x="34" y="22" width="3" height="20" rx="1.5" fill="#FFF8EE" />
              <rect x="39" y="26" width="3" height="12" rx="1.5" fill="#FFF8EE" />
              <rect x="44" y="29" width="3" height="6" rx="1.5" fill="#FFF8EE" />
            </svg>
            <div style={{ display: "flex", fontSize: 28, fontWeight: 700 }}>
              AlarmTalk
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div
              style={{
                display: "flex",
                fontSize: 76,
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
                fontSize: 76,
                fontWeight: 700,
                letterSpacing: "-0.025em",
                lineHeight: 1.05,
                gap: 16,
              }}
            >
              <span>you</span>
              <span style={{ color: "#A8D4FF" }}>love</span>
              <span>.</span>
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 22,
                color: "#A8AEBA",
                marginTop: 14,
              }}
            >
              Voice alarm · Real native ring · Made in Korea
            </div>
          </div>
        </div>

        <div
          style={{
            width: 360,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <img
            src={mobileSrc}
            alt=""
            width={320}
            height={627}
            style={{
              width: 320,
              height: 627,
              borderRadius: 32,
              objectFit: "cover",
              objectPosition: "top",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          />
        </div>
      </div>
    ),
    { ...size },
  );
}
