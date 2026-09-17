"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Play, Square } from "lucide-react";
import { motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { usePrefersReducedMotion } from "./motion/use-prefers-reduced-motion";

/**
 * 「미리 들어보기」 — 기본 목소리 넷의 인사말을 **골라서** 듣는 작은 플레이어.
 *
 * 위에 파형, 아래에 이전 · 재생 · 다음(2026-09-15 지시). 처음(2026-09-05)에는 버튼 하나로
 * 차례로 넘기는 방식이었는데, "다시 누르면 다음 목소리" 는 지금 누가 말하는지·다음이
 * 누구인지가 안 보였다. 화살표는 **누르는 즉시 그 목소리를 튼다** — 고르고 나서 다시
 * 재생을 누르게 하지 않는다(인사말은 3초 남짓이라 듣는 게 곧 고르는 것이다).
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
 * **즉시** 멈춘다(끝날 때까지 기다리게 하지 않는다), 다른 목소리로 넘기면 앞 것을 즉시
 * 끊는다, 스프링은 튕기지 않는다(bounce 0). 축소 동작 설정에서는 눌림 축소만 빼고 파형은
 * 그대로 둔다 — 파형은 사용자가 직접 시작한 재생의 진행 표시라 장식 모션이 아니다.
 */

/** 기본 목소리 4명 — 앱이 보여 주는 순서 그대로(애니의 파일명은 앱과 같은 이력상 이름이 아니라 표시 이름을 따른다). */
const PREVIEW_VOICES = ["siwoo", "mina", "dohyun", "aeni"] as const;

type VoiceId = (typeof PREVIEW_VOICES)[number];

/** 페이지 언어의 인사말. 앱도 기기 언어로 같은 파일을 고른다(`SystemVoices.kt`). */
function previewClipSrc(voice: VoiceId, locale: string): string {
  const lang = locale === "en" || locale === "ja" ? locale : "ko";
  return `/audio/${voice}-greeting.${lang}.mp3`;
}
type Status = "idle" | "loading" | "playing";

const BAR_COUNT = 28;
const MIN_LEVEL = 0.14;

/**
 * 쉬고 있을 때의 파형. 결정적 값이라 서버와 클라가 같은 그림을 그린다(하이드레이션 안전).
 * 소수 셋째 자리에서 끊는다 — 서버 HTML 은 `scaleY(0.22361)` 로 짧게 직렬화되는데 클라는
 * `0.22360999289684322` 를 그대로 문자열로 만들어 속성이 어긋났다(dev 콘솔 hydration 경고).
 */
const REST_LEVELS: readonly number[] = Array.from({ length: BAR_COUNT }, (_, i) => {
  const t = i / (BAR_COUNT - 1);
  const envelope = 1 - Math.abs(t - 0.5) * 1.1;
  const level = MIN_LEVEL + 0.3 * Math.abs(Math.sin(t * Math.PI * 2.3 + 0.6)) * envelope;
  return Math.round(level * 1000) / 1000;
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
  /** 지금 골라져 있는 목소리. 재생·이전·다음이 전부 이 값을 기준으로 움직인다. */
  const [index, setIndex] = useState(0);
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
  /**
   * 재생 회차. **사용자가 멈춘 것을 실패로 말하지 않으려고** 둔다.
   *
   * 파일을 받는 중에 다시 누르면 `stop()` 의 `pause()` 가 아직 안 끝난 `play()` 를
   * `AbortError` 로 거절하는데, 그걸 그대로 잡으면 멈춘 직후에 "지금은 재생할 수 없어요"
   * 가 뜬다 — 멀쩡히 멈췄는데 빨간 글씨가 남는다. 회차가 다르면 그 결과는 **지난 요청의
   * 것**이므로 화면을 건드리지 않는다. 오디오 컨텍스트를 깨우는 사이에 멈춘 경우
   * (`resume()` 대기 중)에도 같은 회차 검사가 재생이 뒤늦게 시작되는 것을 막는다.
   */
  const playGenRef = useRef(0);
  /**
   * 실패를 **화면에 말해도 되는** 회차. `stop()` 이 회차를 올리는 순간 아무도 그 로드를
   * 기다리지 않는다 — `pause()` 는 받는 중인 파일을 취소하지 않으므로 뒤늦게 `error` 가
   * 온다. 그걸 그대로 띄우면 멈춘 위젯에 빨간 글씨가 남는다.
   * ⚠ `audio.src` 를 이 함수 밖에서 새로 넣는 코드가 생기면 여기도 같이 올려야 한다.
   */
  const reportingGenRef = useRef(0);

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

    const analyser = analyserRef.current;
    let level: number;
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

  /** 파형을 쉬는 모양으로 되돌린다 — 목소리를 바꾸거나 새로 틀 때. */
  const resetWave = useCallback(() => {
    capturedRef.current = [...REST_LEVELS];
    playedToRef.current = 0;
    setPlayedTo(0);
    paintRest();
  }, [paintRest]);

  const stop = useCallback(() => {
    playGenRef.current += 1;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    stopLoop();
    setStatus("idle");
  }, [stopLoop]);

  const play = useCallback(
    async (voiceIndex: number) => {
      const generation = (playGenRef.current += 1);
      reportingGenRef.current = generation;
      const voice = PREVIEW_VOICES[voiceIndex];
      const audio = ensureAudio();
      setFailed(false);

      // 재생 중에 다른 목소리로 넘어온 경우: 앞 것의 그리기 루프를 먼저 끊는다(소리는
      // 아래 `src` 교체가 끊는다). 새 재생은 파형을 처음부터 다시 그린다.
      stopLoop();
      resetWave();

      setStatus("loading");
      audio.src = previewClipSrc(voice, locale);
      try {
        // 사용자 제스처 안에서 깨워야 iOS 사파리가 소리를 낸다.
        await ctxRef.current?.resume();
        // 깨우는 사이에 멈췄으면 시작하지 않는다 — 멈췄는데 소리가 나면 안 된다.
        if (playGenRef.current !== generation) return;
        await audio.play();
      } catch {
        // 사용자가 멈춰서 거절된 것은 실패가 아니다.
        if (playGenRef.current !== generation) return;
        setStatus("idle");
        setFailed(true);
      }
    },
    [ensureAudio, locale, resetWave, stopLoop],
  );

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
      // 끝난 파형은 끝까지 색칠해 둔다 — 고른 목소리는 그대로 남는다(다음은 화살표로).
      for (let i = 0; i < BAR_COUNT; i++) setBarHeight(i, capturedRef.current[i]);
      playedToRef.current = BAR_COUNT;
      setPlayedTo(BAR_COUNT);
      setStatus("idle");
    };
    const onError = () => {
      // 사용자가 멈춘 뒤 뒤늦게 온 실패는 말하지 않는다(위 `reportingGenRef`).
      if (playGenRef.current !== reportingGenRef.current) return;
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
    else void play(index);
  };
  /** 이전/다음 — 고르는 즉시 튼다. 재생 중이면 앞 것을 끊고 바로 넘어간다. */
  const step = (delta: 1 | -1) => {
    const next = (index + delta + PREVIEW_VOICES.length) % PREVIEW_VOICES.length;
    setIndex(next);
    void play(next);
  };

  const voice = PREVIEW_VOICES[index];
  const name = t(`voices.${voice}`);

  const tap = reduced ? undefined : { scale: 0.94 };
  const spring = { type: "spring" as const, duration: 0.3, bounce: 0 };
  const sideButton =
    "grid h-11 w-11 shrink-0 place-items-center rounded-full bg-raised text-text-body transition-[background-color,color] duration-150 ease-[var(--ease-ui)] hover:bg-line hover:text-text";

  return (
    <div className={`flex w-full max-w-[420px] flex-col items-center ${className ?? ""}`}>
      <div className="flex w-full flex-col items-center rounded-[var(--radius-xl)] border border-line bg-surface px-5 pb-5 pt-5 shadow-[var(--shadow-card)] sm:px-7">
        {/* 파형 — 높이는 rAF 가 ref 로 직접 만지고, 색만 React 가 정한다. 막대는
            `flex-1 max-w-[3px] min-w-px` 라 좁으면 가늘어지지, 카드가 페이지를 넘지 않는다. */}
        <div
          aria-hidden="true"
          className="flex h-12 w-full items-center justify-between gap-[2px] sm:gap-[3px]"
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

        {/* 이전 · 재생 · 다음. 가운데가 주인공이라 크고 색이 있고, 양옆은 조용히. */}
        <div className="mt-4 flex items-center gap-3 sm:gap-5">
          <motion.button
            type="button"
            onClick={() => step(-1)}
            aria-label={t("prevAria")}
            whileTap={tap}
            transition={spring}
            className={sideButton}
          >
            <ChevronLeft className="h-6 w-6" aria-hidden="true" />
          </motion.button>

          <motion.button
            type="button"
            onClick={onPress}
            aria-label={busy ? t("stopAria", { name }) : t("playAria", { name })}
            whileTap={tap}
            transition={spring}
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

          <motion.button
            type="button"
            onClick={() => step(1)}
            aria-label={t("nextAria")}
            whileTap={tap}
            transition={spring}
            className={sideButton}
          >
            <ChevronRight className="h-6 w-6" aria-hidden="true" />
          </motion.button>
        </div>

        {/* 누구인지. 이름은 항상 보인다 — 화살표가 무엇을 고르는지 알아야 한다. 상태 문구는
            두지 않는다(2026-09-15 지시) — 재생 중/멈춤은 가운데 버튼 모양이 말한다. */}
        <p className="mt-3 text-center text-[15px] font-semibold leading-tight text-text" aria-live="polite">
          {name}
        </p>
        {/* 실패만 말한다 — 눌렀는데 아무 일도 없는 것처럼 보이면 안 된다. */}
        {failed ? (
          <p role="alert" className="mt-1.5 text-center text-[12px] leading-tight text-rose">
            {t("failed")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
