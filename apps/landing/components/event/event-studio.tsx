"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Heart, Play, RotateCcw, Square } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { routing, type Locale } from "@/i18n/routing";
import { usePrefersReducedMotion } from "../motion/use-prefers-reduced-motion";
import { DownloadDialog } from "./download-dialog";
import {
  addLike,
  ClipError,
  clipDownloadUrl,
  fetchLikes,
  generateClip,
  type Clip,
  type LikeCounts,
} from "./event-api";
import {
  CELEBRITIES,
  EVENT_ID,
  EVENT_NAME_MAX_LENGTH,
  MESSAGE_KINDS,
  sanitizeEventName,
  type Celebrity,
  type MessageKind,
} from "./event-catalog";
import { useEventPlayer } from "./use-event-player";

/**
 * 이벤트 1 — 이름을 적고, 인물을 **돌려 보며** 고르고, 생성하기를 누르면 그 인물 목소리로
 * 메시지 **둘 다**(생일 축하 · 위로 한마디)를 만들어 들려준다. 세 언어 모두 들을 수 있다
 * (2026-09-16 지시): 지금 페이지 언어부터 만들고, 다른 언어는 **누르면** 그때 만든다.
 *
 *   이름 입력 → 인물 캐러셀(이전/다음, 좋아요 수) → 생성하기 → 언어 고르기 → 결과 두 줄(듣기 · 다운로드)
 *
 * 소리는 서버가 문장 전체를 인물 목소리로 만든다(`event-api.ts`). 처음 만들 때 10~30초 걸리므로
 * 종류마다 따로 부르고 **오는 대로** 카드를 채운다. 결과는 (인물, 이름, 언어, 종류)에 묶여
 * 캐시된다: 인물을 돌리다 이미 만든 인물로 돌아오면 그 결과가 그대로 있고, 이름을 바꾸면
 * 새로 만든다 — 다른 이름으로 만든 소리를 지금 이름인 것처럼 들려주지 않는다.
 *
 * 링크: `?celeb=winter&name=지민` 으로 들어오면 그 인물·이름으로 **바로** 만든다(홍보 댓글에
 * 보내는 개인 링크). 만든 뒤에는 주소도 그렇게 맞춰 둔다 — 주소창이 곧 공유 링크다.
 *
 * 문장은 화면에 보여 주지 않는다(2026-09-16 지시) — 종류 이름과 듣기·다운로드뿐이다. 재생은
 * 언제나 하나.
 */
type ClipState =
  { status: "pending" } | { status: "ready"; clip: Clip } | { status: "failed"; code: string };

const SLIDE = { type: "spring" as const, duration: 0.35, bounce: 0 };

const clipKey = (celebrityId: string, name: string, locale: Locale, kind: MessageKind) =>
  `${celebrityId}:${name}:${locale}:${kind}`;

export function EventStudio() {
  const t = useTranslations("event");
  const tl = useTranslations("language_switcher");
  const pageLocale = useLocale() as Locale;
  const reduced = usePrefersReducedMotion();
  const uid = useId();
  const [name, setName] = useState("");
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  /** 결과 칸에서 듣는 언어. 페이지 언어로 시작한다. */
  const [lang, setLang] = useState<Locale>(pageLocale);
  /** (인물:이름:언어:종류) → 만드는 중 / 만든 소리 / 실패. */
  const [clips, setClips] = useState<Record<string, ClipState>>({});
  /** 생성하기를 누른 (인물:이름). 결과 칸은 이게 있을 때만 보인다. */
  const [started, setStarted] = useState<Record<string, true>>({});
  const [likes, setLikes] = useState<LikeCounts>({});
  const [download, setDownload] = useState<Clip | null>(null);
  /** 방금 생성하기를 누른 (인물:이름). 결과 칸이 그려진 뒤 한 번 거기로 스크롤하고 지운다. */
  const [justStarted, setJustStarted] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const inflightRef = useRef<Set<string>>(new Set());
  const { activeId, play, stop } = useEventPlayer();
  /** 지금 무엇이 재생 중인지 — 30초 뒤에 온 자동 재생이 사용자가 튼 소리를 끊지 않게. */
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  /**
   * 붙어 있는가. 만드는 데 30초라 그 사이 다른 페이지로 갈 수 있다 — 떠난 뒤 온 소리는 재생하지
   * 않는다. 요청 자체는 끊지 않는다: 서버는 어차피 끝까지 만들어 캐시에 두므로, 돌아오면 바로
   * 들을 수 있다(StrictMode 의 가짜 언마운트에도 맞게 effect 안에서 켠다).
   */
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const celebrity = CELEBRITIES[index];
  const trimmed = name.trim();
  const bundleKey = `${celebrity.id}:${trimmed}`;
  const hasResults = trimmed !== "" && started[bundleKey] === true;
  /** 지금 화면이 보고 있는 (인물:이름:언어). 30초 뒤에 온 소리를 자동 재생해도 되는지 여기 대고 본다. */
  const viewRef = useRef(`${bundleKey}:${lang}`);
  viewRef.current = `${bundleKey}:${lang}`;
  const nameLength = Array.from(name).length;
  const nameOf = (c: Celebrity) => t(`celebrities.${c.id}.name`);

  /**
   * 한 언어의 두 메시지를 만든다. 이미 있거나 만드는 중이면 건너뛴다(`retry` 면 실패한 것을 다시).
   * 첫 메시지가 오면 한 번 자동으로 들려준다 — 단, 그 사이 다른 인물·이름·언어로 옮겨 갔거나
   * 페이지를 떠났거나 사용자가 다른 소리를 틀어 두었으면 들려주지 않는다(보이지 않는 카드가
   * 말하거나 듣던 것을 끊으면 안 된다). 브라우저가 막으면(iOS 는 동작 안에서만) 버튼만 남는다.
   */
  const request = useCallback(
    (
      target: Celebrity,
      targetName: string,
      locale: Locale,
      opts: { autoplay?: boolean; retry?: boolean } = {},
    ) => {
      for (const kind of MESSAGE_KINDS) {
        const key = clipKey(target.id, targetName, locale, kind);
        const cur = clips[key];
        if (inflightRef.current.has(key)) continue;
        if (cur && cur.status !== "failed") continue;
        if (cur?.status === "failed" && !opts.retry) continue;
        inflightRef.current.add(key);
        setClips((c) => ({ ...c, [key]: { status: "pending" } }));
        generateClip({ celebrity: target, name: targetName, locale, kind })
          .then((clip) => {
            if (!mountedRef.current) return;
            setClips((c) => ({ ...c, [key]: { status: "ready", clip } }));
            const stillViewing = viewRef.current === `${target.id}:${targetName}:${locale}`;
            const idle = activeIdRef.current === null;
            if (opts.autoplay && kind === MESSAGE_KINDS[0] && stillViewing && idle) {
              void play(key, clip.src);
            }
          })
          .catch((e: unknown) => {
            if (!mountedRef.current) return;
            const code = e instanceof ClipError ? e.code : "NETWORK";
            setClips((c) => ({ ...c, [key]: { status: "failed", code } }));
          })
          .finally(() => inflightRef.current.delete(key));
      }
    },
    [clips, play],
  );

  // 딥링크: `?celeb=winter`(id) 또는 `?celeb=1`(1부터 세는 순번), 그리고 `?name=지민`. 이름까지
  // 있으면 곧바로 만든다(홍보 댓글에 보내는 개인 링크 — 열면 바로 들린다). 정적 export 라
  // 서버가 쿼리를 모르니 붙은 뒤에 읽고, 그 뒤로는 돌릴 때마다 주소를 따라 바꿔 둔다
  // (replaceState — 뒤로가기 목록을 채우지 않는다). 주소를 읽기 전에 아래 동기화가 먼저 돌아
  // 쿼리를 덮어쓰면 안 된다(StrictMode 의 이중 실행 포함) — 한 번만 읽고, 읽은 뒤에야 동기화를 켠다.
  const [deepLinked, setDeepLinked] = useState(false);
  const readQueryRef = useRef(false);
  useEffect(() => {
    if (readQueryRef.current) return;
    readQueryRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const rawCeleb = params.get("celeb");
    let found = 0;
    if (rawCeleb) {
      const byId = CELEBRITIES.findIndex((c) => c.id === rawCeleb.toLowerCase());
      const byNumber = /^\d+$/.test(rawCeleb) ? Number(rawCeleb) - 1 : -1;
      const idx = byId >= 0 ? byId : byNumber >= 0 && byNumber < CELEBRITIES.length ? byNumber : -1;
      if (idx >= 0) {
        found = idx;
        setIndex(idx);
      }
    }
    const linkedName = sanitizeEventName(params.get("name") ?? "").trim();
    if (linkedName) {
      setName(linkedName);
      const key = `${CELEBRITIES[found].id}:${linkedName}`;
      setStarted((s) => ({ ...s, [key]: true }));
      setJustStarted(key);
      request(CELEBRITIES[found], linkedName, pageLocale, { autoplay: true });
    }
    setDeepLinked(true);
    // 마운트 때 한 번만 읽는다(readQueryRef 가 지킨다) — request 는 그 시점의 것이면 된다.
  }, [pageLocale, request]);
  useEffect(() => {
    if (!deepLinked) return;
    const url = new URL(window.location.href);
    const wantName = hasResults ? trimmed : null;
    if (
      url.searchParams.get("celeb") === celebrity.id &&
      url.searchParams.get("name") === wantName
    ) {
      return;
    }
    url.searchParams.set("celeb", celebrity.id);
    if (wantName) url.searchParams.set("name", wantName);
    else url.searchParams.delete("name");
    window.history.replaceState(window.history.state, "", url);
  }, [deepLinked, celebrity.id, hasResults, trimmed]);

  // 좋아요 수는 서버에서. 못 받으면 빈 채로 둔다(숫자를 지어내지 않는다).
  useEffect(() => {
    let alive = true;
    void fetchLikes(EVENT_ID).then((counts) => {
      if (alive) setLikes(counts);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 인물을 돌리거나 이름·언어를 바꾸면 소리를 멈춘다 — 화면에 없는 것이 계속 말하면 안 된다.
  useEffect(() => {
    if (activeId && !activeId.startsWith(`${bundleKey}:${lang}:`)) stop();
  }, [bundleKey, lang, activeId, stop]);

  // 결과 칸이 보이는데 이 언어의 소리가 없으면 만든다 — 생성하기·언어 버튼이 이미 불렀으면
  // 건너뛴다(request 가 가린다). 이름을 지웠다 되돌렸을 때처럼 버튼을 거치지 않은 길의 안전망이다.
  useEffect(() => {
    if (!hasResults) return;
    const missing = MESSAGE_KINDS.some((k) => !clips[clipKey(celebrity.id, trimmed, lang, k)]);
    if (missing) request(celebrity, trimmed, lang);
  }, [hasResults, celebrity, trimmed, lang, clips, request]);

  // 결과 칸이 접힘선 아래에 생기면 만드는 줄도 모른다 — 그려진 뒤 거기로 데려가고 제목에
  // 초점을 준다(생성하기 버튼이 사라져 초점이 body 로 떨어지는 것을 막는다).
  useEffect(() => {
    if (justStarted === null || justStarted !== bundleKey || !hasResults) return;
    resultsRef.current?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
    resultsHeadingRef.current?.focus({ preventScroll: true });
    setJustStarted(null);
  }, [justStarted, bundleKey, hasResults, reduced]);

  const onGenerate = () => {
    if (!trimmed || hasResults) return;
    setStarted((s) => ({ ...s, [bundleKey]: true }));
    setJustStarted(bundleKey);
    request(celebrity, trimmed, lang, { autoplay: true });
  };

  // 언어를 누르면 그 언어로 만든다. 이미 만들어 둔 것이면 **누른 김에** 첫 메시지를 들려준다 —
  // 눌렀는데 아무 소리도 없으면 안 만들어진 줄 안다(누름 안이라 iOS 도 재생을 허락한다).
  const selectLang = (l: Locale) => {
    setLang(l);
    if (!hasResults) return;
    const first = clips[clipKey(celebrity.id, trimmed, l, MESSAGE_KINDS[0])];
    if (first?.status === "ready") {
      void play(clipKey(celebrity.id, trimmed, l, MESSAGE_KINDS[0]), first.clip.src);
      return;
    }
    request(celebrity, trimmed, l, { autoplay: true });
  };

  const step = (delta: 1 | -1) => {
    setDirection(delta);
    setIndex((i) => (i + delta + CELEBRITIES.length) % CELEBRITIES.length);
  };

  const onLike = async (c: Celebrity) => {
    // 낙관 갱신. 서버가 모르는 대상(숫자 없음)은 하트만 반응한다.
    setLikes((l) => (l[c.id] === undefined ? l : { ...l, [c.id]: l[c.id] + 1 }));
    const count = await addLike(EVENT_ID, c.id);
    if (count !== null) setLikes((l) => ({ ...l, [c.id]: count }));
  };

  const errorText = (code: string) =>
    code === "RATE_LIMITED" ? t("studio.errors.RATE_LIMITED") : t("studio.failed");
  /** 이 언어에 목소리 슬롯이 없다(서버 설정). 카드 대신 한 줄로 말하고 다시 시도는 두지 않는다. */
  const unavailable = MESSAGE_KINDS.some((k) => {
    const st = clips[clipKey(celebrity.id, trimmed, lang, k)];
    return st?.status === "failed" && st.code === "VOICE_NOT_AVAILABLE";
  });

  const tap = reduced ? undefined : { scale: 0.96 };
  const spring = { type: "spring" as const, duration: 0.3, bounce: 0 };

  return (
    <section className="relative" aria-labelledby={`${uid}-h`}>
      <div className="mx-auto max-w-site px-5 pb-24 pt-8 md:px-8 lg:pb-32 lg:pt-12">
        <div className="mx-auto max-w-[560px]">
          {/* 1. 이름 */}
          <h2 id={`${uid}-h`} className="t-h3 text-text">
            <label htmlFor={`${uid}-name`}>{t("studio.nameLabel")}</label>
          </h2>
          <div className="relative mt-3">
            <input
              id={`${uid}-name`}
              type="text"
              name="eventName"
              inputMode="text"
              autoComplete="given-name"
              autoCapitalize="words"
              spellCheck={false}
              enterKeyHint="done"
              aria-describedby={`${uid}-count`}
              value={name}
              onChange={(e) => setName(sanitizeEventName(e.target.value))}
              onKeyDown={(e) => {
                // IME 조합을 확정하는 Enter(한글·일본어)는 생성이 아니다. Safari 는 그 Enter 를
                // isComposing=false 로 주므로 keyCode 229(IME 처리 중)도 같이 본다.
                if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229)
                  onGenerate();
              }}
              placeholder={t("studio.namePlaceholder")}
              className="h-14 w-full rounded-[var(--radius-lg)] border border-line bg-surface px-5 pr-16 text-[18px] font-semibold text-text placeholder:font-medium placeholder:text-text-muted focus-visible:border-accent"
            />
            <span
              id={`${uid}-count`}
              className={`pointer-events-none absolute inset-y-0 right-5 grid place-items-center text-[12px] tabular-nums ${
                nameLength >= EVENT_NAME_MAX_LENGTH ? "text-text" : "text-text-muted"
              }`}
            >
              {nameLength}/{EVENT_NAME_MAX_LENGTH}
            </span>
          </div>

          {/* 2. 인물 캐러셀. 인물이 하나면 화살표·점은 두지 않는다. */}
          <h3 className="t-h3 mt-10 text-text">{t("studio.voiceLabel")}</h3>
          <div className="card mt-3 flex items-center gap-2 p-3 sm:gap-4 sm:p-4">
            {CELEBRITIES.length > 1 ? (
              <motion.button
                type="button"
                onClick={() => step(-1)}
                aria-label={t("studio.prevVoice")}
                whileTap={tap}
                transition={spring}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-pill)] bg-raised text-text-body transition-[background-color,color] duration-150 ease-[var(--ease-ui)] hover:bg-line hover:text-text"
              >
                <ChevronLeft className="h-6 w-6" aria-hidden="true" />
              </motion.button>
            ) : null}

            {/* 한 장씩. 옆으로 밀려 들어오고 나간다(축소 동작이면 그냥 바뀐다). */}
            <div className="relative min-w-0 flex-1 overflow-hidden" aria-live="polite">
              <AnimatePresence initial={false} mode="popLayout" custom={direction}>
                <motion.div
                  key={celebrity.id}
                  custom={direction}
                  initial={reduced ? false : { x: direction * 48, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={reduced ? undefined : { x: direction * -48, opacity: 0 }}
                  transition={SLIDE}
                  className="flex flex-col items-center py-3 text-center"
                >
                  <Portrait
                    src={celebrity.portrait}
                    name={nameOf(celebrity)}
                    alt={t(`celebrities.${celebrity.id}.portraitAlt`)}
                  />
                  <p className="t-h2 mt-4 truncate text-text">{nameOf(celebrity)}</p>
                  <LikeButton
                    count={likes[celebrity.id]}
                    label={t("studio.likeAria", { celebrity: nameOf(celebrity) })}
                    countLabel={
                      likes[celebrity.id] !== undefined
                        ? t("studio.likesCount", { n: likes[celebrity.id] })
                        : undefined
                    }
                    onClick={() => void onLike(celebrity)}
                    reduced={reduced}
                  />
                </motion.div>
              </AnimatePresence>
            </div>

            {CELEBRITIES.length > 1 ? (
              <motion.button
                type="button"
                onClick={() => step(1)}
                aria-label={t("studio.nextVoice")}
                whileTap={tap}
                transition={spring}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-pill)] bg-raised text-text-body transition-[background-color,color] duration-150 ease-[var(--ease-ui)] hover:bg-line hover:text-text"
              >
                <ChevronRight className="h-6 w-6" aria-hidden="true" />
              </motion.button>
            ) : null}
          </div>
          {CELEBRITIES.length > 1 ? (
            // 몇 번째인지. 점은 읽히지 않는다 — 이름과 이전/다음 라벨이 이미 말한다.
            <div aria-hidden="true" className="mt-3 flex items-center justify-center gap-1.5">
              {CELEBRITIES.map((c, i) => (
                <span
                  key={c.id}
                  className={`block h-1.5 w-1.5 rounded-[var(--radius-pill)] ${
                    i === index ? "bg-accent" : "bg-line"
                  }`}
                />
              ))}
            </div>
          ) : null}

          {/* 3. 생성하기 또는 결과. 스크린리더에는 결과 칸이 생긴 순간 제목 문장이 한 번 읽힌다
              (role=status 는 항상 있고 내용만 바뀐다). */}
          <p role="status" className="sr-only">
            {hasResults ? t("studio.resultsHeading", { celebrity: nameOf(celebrity) }) : ""}
          </p>
          {hasResults ? (
            <div ref={resultsRef} className="mt-8 scroll-mt-24">
              <h3 ref={resultsHeadingRef} tabIndex={-1} className="t-h3 text-text outline-none">
                {t("studio.resultsHeading", { celebrity: nameOf(celebrity) })}
              </h3>
              {/* 언어. 누르면 그 언어로 만든다(이미 있으면 바로). 라벨은 각자의 언어로 적혀 있어
                  lang 을 붙인다. */}
              <div
                role="group"
                aria-label={t("studio.languageLabel")}
                className="mt-3 inline-flex items-center rounded-[var(--radius-pill)] border border-line bg-surface p-1"
              >
                {routing.locales.map((l) => {
                  const active = l === lang;
                  return (
                    <button
                      key={l}
                      type="button"
                      lang={l}
                      aria-pressed={active}
                      onClick={() => selectLang(l)}
                      className={`whitespace-nowrap rounded-[var(--radius-pill)] px-3.5 py-1.5 text-[13px] font-semibold transition-[color,background-color] duration-150 ease-[var(--ease-ui)] ${
                        active ? "bg-accent-soft text-accent" : "text-text-muted hover:text-text"
                      }`}
                    >
                      {tl(l)}
                    </button>
                  );
                })}
              </div>
              {unavailable ? (
                // 이 언어에는 목소리 슬롯이 없다(설정). 다시 눌러도 달라지지 않으니 버튼을 두지 않는다.
                <p role="alert" className="card mt-3 p-5 text-text">
                  {t("studio.errors.VOICE_NOT_AVAILABLE")}
                </p>
              ) : (
                <ul lang={lang} className="mt-3 flex flex-col gap-3">
                  {MESSAGE_KINDS.map((kind) => {
                    const key = clipKey(celebrity.id, trimmed, lang, kind);
                    const state = clips[key];
                    const playing = activeId === key;
                    const kindName = t(`studio.kinds.${kind}.name`);
                    return (
                      <li
                        key={kind}
                        tabIndex={-1}
                        aria-busy={!state || state.status === "pending" || undefined}
                        className={`card p-5 outline-none transition-[border-color] duration-200 ease-[var(--ease-ui)] ${
                          playing ? "border-accent" : ""
                        }`}
                      >
                        <p className="t-caption font-semibold text-text-muted">{kindName}</p>
                        {/* 기다리는 동안과 다 됐을 때를 스크린리더가 듣는다(카드 안 글자 바꿈은 읽히지 않는다). */}
                        <p role="status" className="sr-only">
                          {state?.status === "ready"
                            ? `${kindName}: ${t("studio.ready")}`
                            : state?.status === "failed"
                              ? ""
                              : `${kindName}: ${t("studio.generating")}`}
                        </p>
                        {state?.status === "ready" ? (
                          <>
                            {/* 문장은 보여 주지 않는다(2026-09-16 지시) — 들어 보는 것이 전부다. */}
                            <div className="mt-3 flex items-center gap-2">
                              <motion.button
                                type="button"
                                onClick={() => (playing ? stop() : void play(key, state.clip.src))}
                                aria-label={
                                  playing
                                    ? t("studio.stopAria", { kind: kindName })
                                    : t("studio.playAria", {
                                        kind: kindName,
                                        celebrity: nameOf(celebrity),
                                      })
                                }
                                whileTap={tap}
                                transition={spring}
                                className={`btn btn-primary flex-1 gap-2 ${
                                  playing ? "bg-text hover:bg-text-strong" : ""
                                }`}
                              >
                                {playing ? (
                                  <Square className="h-4 w-4 fill-current" aria-hidden="true" />
                                ) : (
                                  <Play
                                    className="ml-0.5 h-4 w-4 fill-current"
                                    aria-hidden="true"
                                  />
                                )}
                                <span>{playing ? t("studio.stop") : t("studio.play")}</span>
                              </motion.button>
                              <motion.button
                                type="button"
                                onClick={() => setDownload(state.clip)}
                                aria-label={t("studio.downloadAria", { kind: kindName })}
                                whileTap={tap}
                                transition={spring}
                                className="inline-grid h-14 w-14 shrink-0 place-items-center rounded-[var(--radius-pill)] border border-line bg-surface text-text transition-[background-color] duration-150 ease-[var(--ease-ui)] hover:bg-raised"
                              >
                                <Download className="h-5 w-5" aria-hidden="true" />
                              </motion.button>
                            </div>
                          </>
                        ) : state?.status === "failed" ? (
                          <>
                            <p role="alert" className="t-body mt-1.5 text-text">
                              {errorText(state.code)}
                            </p>
                            <motion.button
                              type="button"
                              onClick={(e) => {
                                e.currentTarget.closest("li")?.focus({ preventScroll: true });
                                request(celebrity, trimmed, lang, { retry: true });
                              }}
                              whileTap={tap}
                              transition={spring}
                              className="btn btn-secondary mt-4 w-full gap-2"
                            >
                              <RotateCcw className="h-4 w-4" aria-hidden="true" />
                              <span>{t("studio.retry")}</span>
                            </motion.button>
                          </>
                        ) : (
                          <p className="t-body mt-1.5 flex items-center gap-2.5 text-text-muted">
                            <span
                              aria-hidden="true"
                              className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-line border-t-accent"
                            />
                            <span>
                              {t("studio.generating")} {t("studio.generatingHint")}
                            </span>
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : (
            <div className="mt-8">
              <motion.button
                type="button"
                onClick={onGenerate}
                disabled={!trimmed}
                whileTap={trimmed ? tap : undefined}
                transition={spring}
                className="btn btn-primary w-full gap-2 disabled:cursor-default disabled:opacity-40"
              >
                <span>{t("studio.generate")}</span>
              </motion.button>
            </div>
          )}

          <p className="t-caption mt-10 text-center text-text-muted">{t("studio.disclaimer")}</p>
        </div>
      </div>

      <DownloadDialog
        open={download !== null}
        src={
          download
            ? clipDownloadUrl(
                download,
                t("studio.fileName", {
                  celebrity: nameOf(celebrity),
                  kind: t(`studio.kinds.${download.kind}.name`),
                  language: tl(download.locale),
                  name: download.spoken,
                }),
              )
            : null
        }
        onClose={() => setDownload(null)}
      />
    </section>
  );
}

/**
 * 좋아요. 누른 횟수만큼 올라간다(끄기 없음). 숫자는 서버가 줄 때만.
 * 누를 때 하트가 한 번 줄었다 돌아온다 — 낙관 갱신이 눈에 보이게.
 */
function LikeButton({
  count,
  label,
  countLabel,
  onClick,
  reduced,
}: {
  count?: number;
  label: string;
  countLabel?: string;
  onClick: () => void;
  reduced: boolean;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={countLabel ? `${label}. ${countLabel}` : label}
      whileTap={reduced ? undefined : { scale: 0.9 }}
      transition={{ type: "spring", duration: 0.3, bounce: 0 }}
      className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-pill)] border border-line bg-surface px-3.5 text-[14px] font-semibold text-text transition-[background-color] duration-150 ease-[var(--ease-ui)] hover:bg-raised"
    >
      <Heart className="h-4 w-4 fill-accent text-accent" aria-hidden="true" />
      {count !== undefined ? (
        <span className="tabular-nums" aria-hidden="true">
          {count.toLocaleString()}
        </span>
      ) : null}
    </motion.button>
  );
}

/**
 * 인물 사진. 파일이 없거나 못 불러오면 이니셜 원으로 대신한다 — 깨진 이미지 아이콘을 두지
 * 않는다. 사진은 초상권 허락을 받은 것만 `public/event/` 에 넣는다.
 *
 * 정적 HTML 의 img 는 React 가 붙기 전에 이미 실패해 있어 `onError` 가 안 온다. 그래서 붙은
 * 직후 `complete && naturalWidth === 0` 으로 한 번 더 확인한다.
 */
function Portrait({ src, name, alt }: { src: string; name: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth === 0) setFailed(true);
  }, []);
  if (failed) {
    return (
      <span
        role="img"
        aria-label={alt}
        className="grid h-40 w-40 shrink-0 place-items-center rounded-full bg-surface text-[48px] font-bold text-accent ring-1 ring-line"
      >
        {Array.from(name)[0] ?? ""}
      </span>
    );
  }
  return (
    <img
      ref={imgRef}
      src={src}
      alt={alt}
      width={160}
      height={160}
      onError={() => setFailed(true)}
      className="h-40 w-40 shrink-0 rounded-full object-cover ring-1 ring-line"
    />
  );
}
