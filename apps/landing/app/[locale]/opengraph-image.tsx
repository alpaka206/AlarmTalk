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

async function getIconDataUri() {
  const buffer = await readFile(
    join(process.cwd(), "public", "brand-icon.png"),
  );
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

export default async function OpengraphImage() {
  const mobileSrc = await getMobileDataUri();
  const iconSrc = await getIconDataUri();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "row",
          padding: "64px",
          backgroundColor: "#FAF9F5",
          backgroundImage:
            "radial-gradient(circle at 14% 22%, rgba(23,95,176,0.16), transparent 44%), radial-gradient(circle at 88% 24%, rgba(94,155,125,0.12), transparent 46%)",
          color: "#1F1E1C",
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
            <img
              src={iconSrc}
              alt=""
              width={48}
              height={48}
              style={{ borderRadius: 12 }}
            />
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
              <span style={{ color: "#175fb0" }}>love</span>
              <span>.</span>
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 22,
                color: "#6b675f",
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
              border: "1px solid rgba(40,35,25,0.1)",
            }}
          />
        </div>
      </div>
    ),
    { ...size },
  );
}
