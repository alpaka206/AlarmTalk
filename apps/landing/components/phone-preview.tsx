import { ArrowRight, Mic, AlarmClock, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { BrandMark } from "./brand-mark";

const WAVEFORM = [
  0.18, 0.24, 0.16, 0.34, 0.28, 0.52, 0.38, 0.7, 0.42, 0.6, 0.32, 0.56, 0.24,
  0.66, 0.46, 0.78, 0.4, 0.62, 0.34, 0.58, 0.28, 0.54, 0.36, 0.64, 0.44, 0.72,
  0.3, 0.48, 0.22, 0.42, 0.18, 0.36, 0.26, 0.5, 0.2, 0.4, 0.16, 0.32, 0.14,
  0.28,
];

export function PhonePreview() {
  const t = useTranslations("hero.phone");

  return (
    <div className="relative mx-auto w-full max-w-[340px]">
      {/* glow behind device */}
      <div
        aria-hidden="true"
        className="absolute -inset-x-12 -top-10 -bottom-6 -z-10 rounded-[60px] bg-[radial-gradient(circle_at_50%_30%,rgba(168,212,255,0.20),transparent_60%)] blur-2xl"
      />

      {/* device bezel — 9:19.5 portrait */}
      <div
        className="relative aspect-[9/19.5] w-full rounded-[44px] p-[10px]"
        style={{
          background:
            "linear-gradient(180deg, #2a2c38 0%, #15161c 60%, #0a0b10 100%)",
          boxShadow:
            "0 60px 120px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -1px 0 rgba(255,255,255,0.04), 0 0 0 1px rgba(255,255,255,0.05)",
        }}
      >
        {/* punch hole camera */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-[18px] z-20 h-[10px] w-[10px] -translate-x-1/2 rounded-full bg-black ring-1 ring-white/10"
        />

        {/* screen */}
        <div className="relative h-full w-full overflow-hidden rounded-[36px] bg-[#090A0F]">
          {/* status bar */}
          <div className="flex items-center justify-between px-6 pt-4 text-[10.5px] font-semibold text-[#F7F7FA]">
            <span className="whitespace-nowrap">9:41</span>
            <div className="flex items-center gap-1.5">
              <svg width="14" height="9" viewBox="0 0 14 9" fill="none">
                <rect x="0.5" y="0.5" width="11" height="8" rx="1.5" stroke="#F7F7FA" strokeOpacity="0.6" />
                <rect x="2" y="2" width="7" height="5" rx="0.5" fill="#F7F7FA" fillOpacity="0.8" />
                <rect x="12.5" y="2.5" width="1" height="4" rx="0.5" fill="#F7F7FA" fillOpacity="0.6" />
              </svg>
            </div>
          </div>

          {/* content */}
          <div className="px-5 pt-5">
            {/* HomeHeader */}
            <div className="leading-[1.18]">
              <p className="text-[20px] font-bold tracking-[-0.01em] text-[#F7F7FA]">
                {t("greetTop")}
              </p>
              <p className="text-[20px] font-bold tracking-[-0.01em] text-[#F7F7FA]">
                {t("greetBottom")}
              </p>
            </div>

            {/* NextAlarmHeroCard */}
            <div className="mt-5 rounded-[20px] border border-[#2D313D] bg-[#14161E] p-4">
              <p className="text-[10.5px] font-medium text-[#A8AEBA]">
                {t("nextAlarm")}
              </p>
              <p className="mt-1 whitespace-nowrap text-[42px] font-bold leading-none text-[#F7F7FA]">
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
                      backgroundColor: "#A8D4FF",
                      opacity: 0.45 + level * 0.55,
                    }}
                  />
                ))}
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="truncate text-[12.5px] font-semibold text-[#F7F7FA]">
                    {t("alarmLabel")}
                  </p>
                  <p className="truncate text-[10.5px] text-[#A8AEBA]">
                    {t("alarmEdit")}
                  </p>
                </div>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[#A8D4FF]" />
              </div>
            </div>

            {/* QuickStartGrid header */}
            <p className="mt-5 text-[12.5px] font-bold text-[#F7F7FA]">
              {t("quickStart")}
            </p>

            {/* QuickStartGrid 2-up */}
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <QuickCard
                icon={<Mic className="h-3.5 w-3.5" strokeWidth={2.2} />}
                label={t("quickVoice")}
                accentBg="#243F49"
                accentFg="#E2F5FC"
              />
              <QuickCard
                icon={<AlarmClock className="h-3.5 w-3.5" strokeWidth={2.2} />}
                label={t("quickAlarm")}
                accentBg="#1E4263"
                accentFg="#D9ECFF"
              />
            </div>

            {/* CharacterMiniCard */}
            <div className="mt-3 flex items-center gap-3 rounded-[18px] border border-[#2D313D] bg-[#14161E] p-3">
              <div
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[16px]"
                style={{ backgroundColor: "#28483B", color: "#E3F6EC" }}
              >
                🌱
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="whitespace-nowrap text-[11.5px] font-bold text-[#F7F7FA]">
                    LV.3
                  </span>
                  <span className="whitespace-nowrap text-[10px] text-[#A8AEBA]">
                    {t("streak")}
                  </span>
                </div>
                <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-[#20232D]">
                  <div
                    className="h-full rounded-full"
                    style={{ width: "62%", backgroundColor: "#C7E5D6" }}
                  />
                </div>
              </div>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#C7E5D6]" />
            </div>
          </div>

          {/* bottom tab bar */}
          <div className="absolute inset-x-0 bottom-0 border-t border-[#20232D] bg-[#0c0d12]/80 px-5 pb-4 pt-2 backdrop-blur">
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
                    className={`block h-1 w-1 rounded-full ${
                      tab.active ? "bg-[#A8D4FF]" : "bg-transparent"
                    }`}
                  />
                  <span
                    className={`whitespace-nowrap text-[9.5px] font-semibold ${
                      tab.active ? "text-[#F7F7FA]" : "text-[#6F7682]"
                    }`}
                  >
                    {tab.label}
                  </span>
                </div>
              ))}
            </div>
            <div
              aria-hidden="true"
              className="mx-auto mt-3 h-[3px] w-[88px] rounded-full bg-white/30"
            />
          </div>
        </div>
      </div>

      {/* brand mark floating beside */}
      <div
        aria-hidden="true"
        className="absolute -right-3 -top-3 z-30 hidden rounded-2xl border border-line bg-surface p-2 shadow-lg sm:block"
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
    <div className="flex items-center gap-2.5 rounded-[14px] border border-[#2D313D] bg-[#14161E] p-3">
      <div
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full"
        style={{ backgroundColor: accentBg, color: accentFg }}
      >
        {icon}
      </div>
      <span className="truncate text-[11.5px] font-semibold text-[#F7F7FA]">
        {label}
      </span>
    </div>
  );
}
