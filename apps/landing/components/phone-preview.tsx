import { ArrowRight, Mic, AlarmClock, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { BrandMark } from "./brand-mark";

const WAVEFORM = [
  0.18, 0.24, 0.16, 0.34, 0.28, 0.52, 0.38, 0.7, 0.42, 0.6, 0.32, 0.56, 0.24,
  0.66, 0.46, 0.78, 0.4, 0.62, 0.34, 0.58, 0.28, 0.54, 0.36, 0.64, 0.44, 0.72,
  0.3, 0.48, 0.22, 0.42, 0.18, 0.36, 0.26, 0.5, 0.2, 0.4, 0.16, 0.32, 0.14,
  0.28,
];

// Phone screen keeps the app's native dark UI (a real product shot), recolored
// to the brand coral so it reads as one family with the warm light page.
const CORAL = "#ec8c6c";
const SAGE = "#8fbf9e";
const SCREEN_TEXT = "#f7f4ee";
const SCREEN_MUTED = "#b0a89c";
const SCREEN_CARD = "#1c1813";
const SCREEN_LINE = "#2e2820";

export function PhonePreview() {
  const t = useTranslations("hero.phone");

  return (
    <div className="relative mx-auto w-full max-w-[340px]">
      {/* warm glow behind device */}
      <div
        aria-hidden="true"
        className="absolute -inset-x-12 -top-10 -bottom-6 -z-10 rounded-[60px] bg-[radial-gradient(circle_at_50%_30%,rgba(217,119,87,0.20),transparent_60%)] blur-2xl"
      />

      {/* device bezel — 9:19.5 portrait */}
      <div
        className="relative aspect-[9/19.5] w-full rounded-[44px] p-[10px]"
        style={{
          background:
            "linear-gradient(180deg, #2b2724 0%, #16130f 60%, #0c0a08 100%)",
          boxShadow:
            "0 40px 90px rgba(70,52,34,0.28), inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -1px 0 rgba(255,255,255,0.04), 0 0 0 1px rgba(255,255,255,0.05)",
        }}
      >
        {/* punch hole camera */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-[18px] z-20 h-[10px] w-[10px] -translate-x-1/2 rounded-full bg-black ring-1 ring-white/10"
        />

        {/* screen */}
        <div className="relative h-full w-full overflow-hidden rounded-[36px] bg-[#100e0b]">
          {/* status bar */}
          <div className="flex items-center justify-between px-6 pt-4 text-[10.5px] font-semibold" style={{ color: SCREEN_TEXT }}>
            <span className="whitespace-nowrap">9:41</span>
            <div className="flex items-center gap-1.5">
              <svg width="14" height="9" viewBox="0 0 14 9" fill="none">
                <rect x="0.5" y="0.5" width="11" height="8" rx="1.5" stroke={SCREEN_TEXT} strokeOpacity="0.6" />
                <rect x="2" y="2" width="7" height="5" rx="0.5" fill={SCREEN_TEXT} fillOpacity="0.8" />
                <rect x="12.5" y="2.5" width="1" height="4" rx="0.5" fill={SCREEN_TEXT} fillOpacity="0.6" />
              </svg>
            </div>
          </div>

          {/* content */}
          <div className="px-5 pt-5">
            {/* HomeHeader */}
            <div className="leading-[1.18]">
              <p className="text-[20px] font-bold tracking-[-0.01em]" style={{ color: SCREEN_TEXT }}>
                {t("greetTop")}
              </p>
              <p className="text-[20px] font-bold tracking-[-0.01em]" style={{ color: SCREEN_TEXT }}>
                {t("greetBottom")}
              </p>
            </div>

            {/* NextAlarmHeroCard */}
            <div className="mt-5 rounded-[20px] p-4" style={{ border: `1px solid ${SCREEN_LINE}`, background: SCREEN_CARD }}>
              <p className="text-[10.5px] font-medium" style={{ color: SCREEN_MUTED }}>
                {t("nextAlarm")}
              </p>
              <p className="mt-1 whitespace-nowrap text-[42px] font-bold leading-none" style={{ color: SCREEN_TEXT }}>
                07:30
              </p>

              {/* mini waveform */}
              <div className="mt-4 flex h-[28px] items-center justify-between gap-[1.5px]">
                {WAVEFORM.map((level, i) => (
                  <span
                    key={i}
                    className="block w-[1.5px] rounded-full"
                    style={{
                      height: `${5 + level * 22}px`,
                      backgroundColor: CORAL,
                      opacity: 0.45 + level * 0.55,
                    }}
                  />
                ))}
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="truncate text-[12.5px] font-semibold" style={{ color: SCREEN_TEXT }}>
                    {t("alarmLabel")}
                  </p>
                  <p className="truncate text-[10.5px]" style={{ color: SCREEN_MUTED }}>
                    {t("alarmEdit")}
                  </p>
                </div>
                <ArrowRight className="h-3.5 w-3.5 shrink-0" style={{ color: CORAL }} />
              </div>
            </div>

            {/* QuickStartGrid header */}
            <p className="mt-5 text-[12.5px] font-bold" style={{ color: SCREEN_TEXT }}>
              {t("quickStart")}
            </p>

            {/* QuickStartGrid 2-up */}
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <QuickCard
                icon={<Mic className="h-3.5 w-3.5" strokeWidth={2.2} />}
                label={t("quickVoice")}
                accentBg="#3a2a22"
                accentFg="#f4d8c9"
              />
              <QuickCard
                icon={<AlarmClock className="h-3.5 w-3.5" strokeWidth={2.2} />}
                label={t("quickAlarm")}
                accentBg="#33291c"
                accentFg="#f2e2c4"
              />
            </div>

            {/* CharacterMiniCard */}
            <div className="mt-3 flex items-center gap-3 rounded-[18px] p-3" style={{ border: `1px solid ${SCREEN_LINE}`, background: SCREEN_CARD }}>
              <div
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[16px]"
                style={{ backgroundColor: "#2e3a2c", color: "#dcebd6" }}
              >
                🌱
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="whitespace-nowrap text-[11.5px] font-bold" style={{ color: SCREEN_TEXT }}>
                    LV.3
                  </span>
                  <span className="whitespace-nowrap text-[10px]" style={{ color: SCREEN_MUTED }}>
                    {t("streak")}
                  </span>
                </div>
                <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full" style={{ backgroundColor: "#262019" }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: "62%", backgroundColor: SAGE }}
                  />
                </div>
              </div>
              <ChevronRight className="h-3.5 w-3.5 shrink-0" style={{ color: SAGE }} />
            </div>
          </div>

          {/* bottom tab bar */}
          <div className="absolute inset-x-0 bottom-0 px-5 pb-4 pt-2 backdrop-blur" style={{ borderTop: `1px solid ${SCREEN_LINE}`, background: "rgba(12,10,8,0.8)" }}>
            <div className="flex items-center justify-between">
              {[
                { label: t("tabHome"), active: true },
                { label: t("tabVoice"), active: false },
                { label: t("tabAlarms"), active: false },
                { label: t("tabMessages"), active: false },
              ].map((tab) => (
                <div
                  key={tab.label}
                  className="flex flex-col items-center gap-1"
                >
                  <span
                    className="block h-1 w-1 rounded-full"
                    style={{ backgroundColor: tab.active ? CORAL : "transparent" }}
                  />
                  <span
                    className="whitespace-nowrap text-[9.5px] font-semibold"
                    style={{ color: tab.active ? SCREEN_TEXT : "#8a8175" }}
                  >
                    {tab.label}
                  </span>
                </div>
              ))}
            </div>
            <div
              aria-hidden="true"
              className="mx-auto mt-3 h-[3px] w-[88px] rounded-full bg-white/25"
            />
          </div>
        </div>
      </div>

      {/* brand mark floating beside */}
      <div
        aria-hidden="true"
        className="absolute -right-3 -top-3 z-30 hidden rounded-2xl border border-line bg-surface p-2 shadow-[0_10px_30px_rgba(90,75,55,0.16)] sm:block"
      >
        <BrandMark size={28} className="rounded-md" />
      </div>
    </div>
  );
}

function QuickCard({
  icon,
  label,
  accentBg,
  accentFg,
}: {
  icon: React.ReactNode;
  label: string;
  accentBg: string;
  accentFg: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-[14px] p-3" style={{ border: "1px solid #2e2820", background: "#1c1813" }}>
      <div
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full"
        style={{ backgroundColor: accentBg, color: accentFg }}
      >
        {icon}
      </div>
      <span className="truncate text-[11.5px] font-semibold" style={{ color: "#f7f4ee" }}>
        {label}
      </span>
    </div>
  );
}
