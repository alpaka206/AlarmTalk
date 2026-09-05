"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import { motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { usePrefersReducedMotion } from "./motion/use-prefers-reduced-motion";

/**
 * 「미리 들어보기」 — 기본 목소리 넷의 인사말을 **한 버튼으로 차례로** 들려준다.
 *
 * 고르는 UI 가 아니다(2026-09-05 지시: "선택해서 듣는 건 아니고"). 첫 화면에서 할 일은
 * "이 앱은 이런 소리가 난다" 를 3초 안에 넘기는 것이고, 넷 중 무엇을 고를지는 앱에서
 * 정한다. 누를 때마다 다음 목소리로 넘어가고, 다 돌면 처음으로 돌아온다.
 *
 * 클립은 앱이 목소리를 눌렀을 때 트는 인사말 **그 파일**이다(안드로이드
 * `res/raw/voice_greeting_<voice>_<lang>.mp3` 를 `public/audio/` 로 복사, 언어별 3벌).
 * 여기서 들은 소리가 앱에서 나는 소리다 — 웹용으로 따로 다듬은 샘플을 쓰면 첫 알람에서
 * "광고랑 다르다" 가 된다. 앱의 인사말이 바뀌면 이 복사본도 같이 바꾼다.
 *
 * 파형은 장식이 아니라 **재생 중인 소리의 실제 크기**다. 재생 헤드가 지나간 막대는
 * 그 순간의 음량을 붙잡아 두어, 인사말이 끝나면 방금 들은 문장의 파형이 남는다.
 * 소리 없이 흔들리는 파형은 '살아 있는 척' 이라 두지 않는다.
 *
 * 움직임 규약(apple-design 스킬): 누르는 순간 반응(`whileTap`), 재생 중 다시 누르면
 * **즉시** 멈춘다(끝날 때까지 기다리게 하지 않는다), 스프링은 튕기지 않는다(bounce 0).
 * 축소 동작 설정에서는 눌림 축소만 빼고 파형은 그대로 둔다 — 파형은 사용자가 직접
 * 시작한 재생의 진행 표시라 장식 모션이 아니다.
 */

/** 기본 목소리 4명 — 앱이 보여 주는 순서 그대로(애니의 파일명은 앱과 같은 이력상 이름이 아니라 표시 이름을 따른다). */
export const PREVIEW_VOICES = ["siwoo", "mina", "dohyun", "aeni"] as const;

type VoiceId = (typeof PREVIEW_VOICES)[number];

/** 페이지 언어의 인사말. 앱도 기기 언어로 같은 파일을 고른다(`SystemVoices.kt`). */
function previewClipSrc(voice: VoiceId, locale: string): string {
  const lang = locale === "en" || locale === "ja" ? locale : "ko";
  return `/audio/${voice}-greeting.${lang}.mp3`;
}
type Status = "idle" | "loading" | "playing";

const BAR_COUNT = 28;
const MIN_LEVEL = 0.14;

/** 쉬고 있을 때의 파형. 결정적 값이라 서버와 클라가 같은 그림을 그린다(하이드레이션 안전). */
const REST_LEVELS: readonly number[] = Array.from({ length: BAR_COUNT }, (_, i) => {
  const t = i / (BAR_COUNT - 1);
  const envelope = 1 - Math.abs(t - 0.5) * 1.1;
  return MIN_LEVEL + 0.3 * Math.abs(Math.sin(t * Math.PI * 2.3 + 0.6)) * envelope;
});

/** 시간 영역 샘플의 RMS(0..1). 목소리는 대개 0.05~0.3 사이라 3.2 배로 펴서 쓴다. */
function rmsLevel(buf: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / buf.length);
  return Math.min(1, Math.max(MIN_LEVEL, rms * 3.2));
}

export function VoicePreview({ className }: { className?: string }) {
  const t = useTranslations("voicePreview");
  const locale = useLocale();
  const reduced = usePrefersReducedMotion();

  const [status, setStatus] = useState<Status>("idle");
  /** 다음에 들려줄 목소리. */
  const [nextIndex, setNextIndex] = useState(0);
  /** 지금 말하고 있거나 마지막으로 말한 목소리. */
  const [spoken, setSpoken] = useState<VoiceId | null>(null);
  /** 재생 헤드가 지나간 막대 수(0..BAR_COUNT). 색칠에만 쓴다 — 높이는 ref 로 직접 만진다. */
  const [playedTo, setPlayedTo] = useState(0);
  const [failed, setFailed] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const capturedRef = useRef<number[]>([...REST_LEVELS]);
  const rafRef = useRef<number>(0);
  const playedToRef = useRef(0);

  const setBarHeight = useCallback((i: number, level: number) => {
    const el = barRefs.current[i];
    if (el) el.style.transform = `scaleY(${level})`;
  }, []);

  const paintRest = useCallback(() => {
    for (let i = 0; i < BAR_COUNT; i++) setBarHeight(i, capturedRef.current[i]);
  }, [setBarHeight]);

  const stopLoop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  }, []);

  /** 오디오 요소는 처음 누를 때 만든다 — 첫 화면 로드에 오디오 요청을 얹지 않는다. */
  const ensureAudio = useCallback(() => {
    if (audioRef.current) return audioRef.current;
    const audio = new Audio();
    audio.preload = "none";
    audioRef.current = audio;

    // 분석기는 있으면 쓰고 없으면(구형 브라우저) 조용히 시간 기반으로 떨어진다.
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        const source = ctx.createMediaElementSource(audio);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.6;
        source.connect(analyser);
        analyser.connect(ctx.destination);
        ctxRef.current = ctx;
        analyserRef.current = analyser;
      }
    } catch {
      ctxRef.current = null;
      analyserRef.current = null;
    }
    return audio;
  }, []);

  const tick = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || audio.paused) return;
    const duration = audio.duration || 0;
    const progress = duration > 0 ? Math.min(1, audio.currentTime / duration) : 0;
    const head = Math.min(BAR_COUNT - 1, Math.floor(progress * BAR_COUNT));

    let level = MIN_LEVEL;
    const analyser = analyserRef.current;
    if (analyser) {
      const buf = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(buf);
      level = rmsLevel(buf);
    } else {
      // 분석기가 없으면 소리 크기를 모른다 — 진행만 보여 준다.
      level = 0.55;
    }

    // 지나간 막대는 그 구간에서 본 최댓값을 붙잡아 둔다 — 문장의 파형이 남는다.
    const captured = capturedRef.current;
    captured[head] = Math.max(captured[head] === REST_LEVELS[head] ? 0 : captured[head], level);
    for (let i = 0; i < BAR_COUNT; i++) {
      if (i < head) setBarHeight(i, captured[i]);
      else if (i === head) setBarHeight(i, level);
      else setBarHeight(i, REST_LEVELS[i]);
    }

    if (head + 1 !== playedToRef.current) {
      playedToRef.current = head + 1;
      setPlayedTo(head + 1);
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [setBarHeight]);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    stopLoop();
    setStatus("idle");
  }, [stopLoop]);

  const play = useCallback(async () => {
    const voice = PREVIEW_VOICES[nextIndex];
    const audio = ensureAudio();
    setFailed(false);

    // 새 재생은 파형을 처음부터 다시 그린다.
    capturedRef.current = [...REST_LEVELS];
    playedToRef.current = 0;
    setPlayedTo(0);
    paintRest();

    setSpoken(voice);
    setStatus("loading");
    audio.src = previewClipSrc(voice, locale);
    try {
      // 사용자 제스처 안에서 깨워야 iOS 사파리가 소리를 낸다.
      await ctxRef.current?.resume();
      await audio.play();
    } catch {
      setStatus("idle");
      setFailed(true);
    }
  }, [ensureAudio, locale, nextIndex, paintRest]);

  // 재생 이벤트는 요소에 한 번만 건다(재생마다 걸면 핸들러가 쌓인다).
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      stopLoop();
      audio?.pause();
      ctxRef.current?.close().catch(() => undefined);
    };
  }, [stopLoop]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlaying = () => {
      setStatus("playing");
      stopLoop();
      rafRef.current = requestAnimationFrame(tick);
    };
    const onEnded = () => {
      stopLoop();
      // 끝난 파형은 끝까지 색칠해 둔다.
      for (let i = 0; i < BAR_COUNT; i++) setBarHeight(i, capturedRef.current[i]);
      playedToRef.current = BAR_COUNT;
      setPlayedTo(BAR_COUNT);
      setStatus("idle");
      setNextIndex((i) => (i + 1) % PREVIEW_VOICES.length);
    };
    const onError = () => {
      stopLoop();
      setStatus("idle");
      setFailed(true);
    };
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
    // audioRef.current 는 첫 play 에서 생기므로 status 가 바뀔 때 다시 건다.
  }, [status, stopLoop, tick, setBarHeight]);

  const busy = status !== "idle";
  const onPress = () => {
    if (busy) stop();
    else void play();
  };

  const name = spoken ? t(`voices.${spoken}`) : null;
  const primaryLine = name ?? t("idleTitle");
  const secondaryLine = failed
    ? t("failed")
    : status === "playing"
      ? t("speaking")
      : status === "loading"
        ? t("loading")
        : name
          ? t("tapForNext")
          : t("idleCaption");

  return (
    <div className={`flex w-full max-w-[460px] flex-col items-center ${className ?? ""}`}>
      {/* 폭 예산(375px 기준 335): 버튼 56 + 막대(줄어듦) + 글자 칸(최대 120) + 여백. 막대는
          `flex-1 max-w-[3px] min-w-px` 라 좁으면 가늘어지지, 알약이 페이지를 넘지 않는다. */}
      <div className="flex w-full items-center gap-3 rounded-[var(--radius-pill)] border border-line bg-surface py-2 pl-2 pr-4 shadow-[var(--shadow-card)] sm:gap-4 sm:pr-5">
        <motion.button
          type="button"
          onClick={onPress}
          aria-label={busy ? t("stopAria", { name: name ?? "" }) : t("playAria")}
          whileTap={reduced ? undefined : { scale: 0.94 }}
          transition={{ type: "spring", duration: 0.3, bounce: 0 }}
          className="relative grid h-14 w-14 shrink-0 place-items-center rounded-full bg-accent text-white transition-[background-color] duration-150 ease-[var(--ease-ui)] hover:bg-accent-strong"
        >
          {busy ? (
            <Square className="h-5 w-5 fill-current" aria-hidden="true" />
          ) : (
            <Play className="ml-0.5 h-6 w-6 fill-current" aria-hidden="true" />
          )}
          {status === "loading" ? (
            <span
              aria-hidden="true"
              className="absolute inset-0 animate-spin rounded-full border-2 border-white/30 border-t-white"
            />
          ) : null}
        </motion.button>

        {/* 파형 — 높이는 rAF 가 ref 로 직접 만지고, 색만 React 가 정한다. */}
        <div
          aria-hidden="true"
          className="flex h-10 min-w-0 flex-1 items-center justify-between gap-[2px] sm:gap-[3px]"
        >
          {REST_LEVELS.map((level, i) => (
            <span
              key={i}
              ref={(el) => {
                barRefs.current[i] = el;
              }}
              className={`block h-full min-w-px max-w-[3px] flex-1 origin-center rounded-full ${
                i < playedTo ? "bg-accent" : "bg-gray-300"
              } ${reduced ? "" : "transition-[background-color] duration-200 ease-[var(--ease-ui)]"}`}
              style={{ transform: `scaleY(${level})` }}
            />
          ))}
        </div>

        <div className="min-w-[5.5rem] max-w-[7.5rem] text-left sm:max-w-none" aria-live="polite">
          <p className="truncate text-[14px] font-semibold leading-tight text-text sm:text-[15px]">
            {primaryLine}
          </p>
          <p className={`mt-0.5 truncate text-[12px] leading-tight ${failed ? "text-rose" : "text-text-muted"}`}>
            {secondaryLine}
          </p>
        </div>
      </div>
    </div>
  );
}
