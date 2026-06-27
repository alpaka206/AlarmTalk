import { Mic, Heart, Languages, Send, ArrowRight } from "lucide-react";
import { Reveal } from "../motion/reveal";
import { RevealGroup, RevealItem } from "../motion/reveal-group";
import { LivingWaveform } from "../motion/living-waveform";

const CARD =
  "rounded-[28px] border border-line bg-surface p-6 shadow-[0_24px_60px_rgba(90,75,55,0.10)]";

// 48-bar recording waveform; bars 0..31 are the "played" (coral) portion.
const VOICE_BARS = [
  0.2, 0.3, 0.5, 0.4, 0.7, 0.55, 0.85, 0.45, 0.6, 0.8, 0.4, 0.55, 0.75, 0.5,
  0.35, 0.65, 0.9, 0.6, 0.45, 0.7, 0.5, 0.85, 0.55, 0.4, 0.7, 0.6, 0.45, 0.8,
  0.35, 0.55, 0.7, 0.5, 0.85, 0.4, 0.6, 0.75, 0.45, 0.65, 0.5, 0.4, 0.6, 0.8,
  0.45, 0.55, 0.7, 0.5, 0.35, 0.55,
];

// Visual for "voice" — recording UI
export function VoiceVisual() {
  return (
    <div className="relative w-full max-w-105">
      <div className="absolute -inset-4 -z-10 rounded-[40px] bg-[radial-gradient(circle_at_50%_30%,rgba(23,95,176,0.12),transparent_60%)] blur-2xl" />
      <div className={CARD}>
        <div className="flex items-center justify-between">
          <span className="whitespace-nowrap text-[12px] font-semibold uppercase tracking-[0.12em] text-text-muted">
            Recording
          </span>
          <span className="flex items-center gap-1.5 whitespace-nowrap text-[12px] font-semibold text-rose">
            <span className="block h-2 w-2 animate-pulse rounded-full bg-rose" />
            00:08
          </span>
        </div>
        {/* the signature playback sweep */}
        <div className="mt-6 h-16">
          <LivingWaveform
            bars={VOICE_BARS}
            mode="playOnce"
            playedTo={32}
            color="var(--color-accent)"
            restColor="var(--color-line)"
            barWidth="flex"
            gapPx={2}
            minPx={2}
            spanPx={62}
            align="end"
            activeOpacity={0.9}
            restOpacity={1}
          />
        </div>
        <div className="mt-6 flex items-center justify-between">
          <span className="text-[12.5px] text-text-muted">&ldquo;늦지 않게 일어나자.&rdquo;</span>
          <button
            type="button"
            className="grid h-12 w-12 place-items-center rounded-full bg-accent text-white shadow-[0_8px_20px_rgba(23,95,176,0.28)]"
          >
            <Mic className="h-5 w-5" strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </div>
  );
}

// Visual for "shared" — voice library cards
export function SharedVisual() {
  const profiles = [
    { name: "엄마", from: "공유 받음 · 7일 전", color: "#5e8fbf" },
    { name: "지수 (커플)", from: "공유 받음 · 어제", color: "#7fb096" },
    { name: "친구 민준", from: "공유 받음 · 3일 전", color: "#e0b15e" },
  ];
  return (
    <div className="relative w-full max-w-105">
      <div className="absolute -inset-4 -z-10 rounded-[40px] bg-[radial-gradient(circle_at_50%_30%,rgba(23,95,176,0.1),transparent_60%)] blur-2xl" />
      <div className={CARD}>
        <div className="flex items-center justify-between">
          <span className="text-[16px] font-bold text-text">공유 음성</span>
          <span className="inline-flex h-7 items-center rounded-full bg-accent-soft px-2.5 text-[11px] font-bold text-accent">
            <Heart className="mr-1 h-3 w-3 fill-accent" strokeWidth={0} />
            가족 공유
          </span>
        </div>
        <RevealGroup className="mt-5 space-y-2.5" stagger={0.08} delay={0.1}>
          {profiles.map((p) => (
            <RevealItem
              key={p.name}
              className="flex items-center gap-3 rounded-2xl border border-line bg-raised p-3.5"
            >
              <div
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[14px] font-bold"
                style={{ backgroundColor: p.color, color: "#fff" }}
              >
                {p.name.slice(0, 1)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold text-text">
                  {p.name}
                </p>
                <p className="truncate text-[11px] text-text-muted">{p.from}</p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-text-dim" />
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </div>
  );
}

// Visual for "language" — translated sentence card
export function LanguageVisual() {
  return (
    <div className="relative w-full max-w-105">
      <div className="absolute -inset-4 -z-10 rounded-[40px] bg-[radial-gradient(circle_at_50%_30%,rgba(143,191,158,0.12),transparent_60%)] blur-2xl" />
      <div className={CARD}>
        <div className="flex items-center justify-between">
          <span className="text-[16px] font-bold text-text">번역 메시지</span>
          <Languages className="h-4 w-4 text-mint" strokeWidth={2.2} />
        </div>
        <div className="mt-5 rounded-2xl border border-line bg-raised p-4">
          <span className="inline-flex h-6 items-center rounded-full bg-accent-soft px-2 text-[10.5px] font-bold uppercase tracking-wider text-accent">
            EN · 원어민 발음
          </span>
          {/* transcript "plays" left-to-right, then the source line fades in */}
          <Reveal
            as="p"
            variant="wipe"
            delay={0.15}
            className="mt-3 text-[15px] font-semibold text-text"
          >
            &ldquo;Don&rsquo;t oversleep — today matters.&rdquo;
          </Reveal>
          <Reveal
            as="p"
            delay={0.55}
            className="mt-2 text-[12px] text-text-muted"
          >
            늦잠 자지 마. 오늘이 중요한 날이야.
          </Reveal>
        </div>
        <div className="mt-3 flex items-center justify-between rounded-2xl border border-line bg-raised p-3.5">
          <div>
            <p className="text-[11.5px] text-text-muted">내일 06:30 알람</p>
            <p className="mt-0.5 text-[13.5px] font-semibold text-text">
              위 문장을 알람으로
            </p>
          </div>
          <button
            type="button"
            className="inline-flex h-9 items-center whitespace-nowrap rounded-full bg-accent px-4 text-[12.5px] font-bold text-white"
          >
            <Send className="mr-1.5 h-3.5 w-3.5" />
            등록
          </button>
        </div>
      </div>
    </div>
  );
}
