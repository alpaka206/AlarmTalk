"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Heart, Play, Square } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { usePrefersReducedMotion } from "../motion/use-prefers-reduced-motion";
import { DownloadDialog } from "./download-dialog";
import {
  addLike,
  downloadableSrc,
  fetchLikes,
  generateVoiceMessage,
  type EventPlayback,
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
 * 메시지 **둘 다**(생일 축하 · 위로 한마디)를 만들어 들려준다(2026-09-15 지시).
 *
 *   이름 입력 → 인물 캐러셀(이전/다음, 좋아요 수) → 생성하기 → 결과 두 줄(듣기 · 다운로드)
 *
 * 결과는 (인물, 이름) 에 묶여 캐시된다: 인물을 돌리다 이미 만든 인물로 돌아오면 그 결과가
 * 그대로 있고, 안 만든 인물이면 생성하기가 보인다. 이름을 바꾸면 전부 새로 만든다 — 다른
 * 이름으로 만든 소리를 지금 이름인 것처럼 들려주지 않는다.
 *
 * 만들고 나면 결과로 스크롤하고 첫 듣기 버튼에 초점을 준다(모바일에서 버튼이 접힘선 근처에
 * 있으면 결과가 화면 밖에 생긴다는 검수 지적). 문구는 `t.rich` 로 이름 자리만 강조하고
 * 사용자가 친 값은 값으로만 들어간다. 생성·좋아요는 `event-api.ts` 만 안다. 재생은 언제나 하나.
 */
type Status = "idle" | "generating" | "failed";

type Bundle = Record<MessageKind, EventPlayback>;

const SLIDE = { type: "spring" as const, duration: 0.35, bounce: 0 };

export function EventStudio() {
  const t = useTranslations("event");
  const locale = useLocale();
  const reduced = usePrefersReducedMotion();
  const uid = useId();
  const [name, setName] = useState("");
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [status, setStatus] = useState<Status>("idle");
  /** (인물:이름) → 만든 소리 둘. */
  const [bundles, setBundles] = useState<Record<string, Bundle>>({});
  const [likes, setLikes] = useState<LikeCounts>({});
  const [download, setDownload] = useState<{ kind: MessageKind } | null>(null);
  /** 방금 만든 결과의 키. 그 결과가 그려진 뒤 한 번 스크롤·초점을 옮기고 지운다. */
  const [justMade, setJustMade] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const firstPlayRef = useRef<HTMLButtonElement | null>(null);
  const { activeId, play, stop, unsupported } = useEventPlayer();

  const celebrity = CELEBRITIES[index];
  const trimmed = name.trim();

  // 딥링크: `?celeb=winter`(id) 또는 `?celeb=1`(1부터 세는 순번). 홍보 링크로 들어오면 그 인물로
  // 시작한다. 정적 export 라 서버가 쿼리를 모르니 붙은 뒤에 읽고, 돌릴 때마다 주소를 바꿔 둔다
  // (replaceState — 뒤로가기 목록을 채우지 않는다).
  // 주소를 읽기 전에 아래 동기화가 먼저 돌아 쿼리를 덮어쓰면 안 된다(StrictMode 의 이중
  // 실행 포함) — 한 번만 읽고, 읽은 뒤에야 동기화를 켠다.
  const [deepLinked, setDeepLinked] = useState(false);
  const readQueryRef = useRef(false);
  useEffect(() => {
    if (readQueryRef.current) return;
    readQueryRef.current = true;
    const raw = new URLSearchParams(window.location.search).get("celeb");
    if (raw) {
      const byId = CELEBRITIES.findIndex((c) => c.id === raw.toLowerCase());
      const byNumber = /^\d+$/.test(raw) ? Number(raw) - 1 : -1;
      const found = byId >= 0 ? byId : byNumber >= 0 && byNumber < CELEBRITIES.length ? byNumber : -1;
      if (found >= 0) setIndex(found);
    }
    setDeepLinked(true);
  }, []);
  useEffect(() => {
    if (!deepLinked) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("celeb") === celebrity.id) return;
    url.searchParams.set("celeb", celebrity.id);
    window.history.replaceState(window.history.state, "", url);
  }, [deepLinked, celebrity.id]);
  const nameLength = Array.from(name).length;
  const key = `${celebrity.id}:${trimmed}`;
  const bundle = trimmed ? bundles[key] : undefined;
  const nameOf = (c: Celebrity) => t(`celebrities.${c.id}.name`);
  const playIdFor = (kind: MessageKind) => `${key}:${kind}`;

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

  // 인물을 돌리거나 이름을 바꾸면 소리를 멈춘다 — 화면에 없는 것이 계속 말하면 안 된다.
  useEffect(() => {
    if (activeId && !activeId.startsWith(`${key}:`)) stop();
  }, [key, activeId, stop]);

  // 결과가 접힘선 아래에 생기면 소리만 나고 멈춤 버튼은 안 보인다 — 결과가 그려진 뒤
  // 거기로 데려가고 첫 듣기/멈춤 버튼에 초점을 준다(입력칸 키보드도 닫힌다).
  useEffect(() => {
    if (justMade === null || justMade !== key || !bundle) return;
    resultsRef.current?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
    firstPlayRef.current?.focus({ preventScroll: true });
    setJustMade(null);
  }, [justMade, key, bundle, reduced]);

  // 읽어 줄 문장은 태그를 벗긴 **문자열**이어야 한다 — 화면용 `t.rich` 와 같은 메시지를
  // `t.markup` 으로 풀어 쓴다(`<b>` 는 강조 표시일 뿐 소리에는 없다).
  const lineText = (kind: MessageKind) =>
    t.markup(`studio.kinds.${kind}.line`, { name: trimmed, b: (chunks) => chunks });

  const onGenerate = async () => {
    if (!trimmed || status === "generating") return;
    const target = celebrity;
    const targetKey = key;
    setStatus("generating");
    try {
      const made = await Promise.all(
        MESSAGE_KINDS.map((kind) =>
          generateVoiceMessage({ celebrity: target, kind, text: lineText(kind), locale }),
        ),
      );
      const next = Object.fromEntries(MESSAGE_KINDS.map((kind, i) => [kind, made[i]])) as Bundle;
      setBundles((b) => ({ ...b, [targetKey]: next }));
      setStatus("idle");
      setJustMade(targetKey);
      play(`${targetKey}:${MESSAGE_KINDS[0]}`, next[MESSAGE_KINDS[0]]);
    } catch {
      setStatus("failed");
    }
  };

  const step = (delta: 1 | -1) => {
    setDirection(delta);
    setIndex((i) => (i + delta + CELEBRITIES.length) % CELEBRITIES.length);
    if (status === "failed") setStatus("idle");
  };

  const onLike = async (c: Celebrity) => {
    // 낙관 갱신. 서버가 모르는 대상(숫자 없음)은 하트만 반응한다.
    setLikes((l) => (l[c.id] === undefined ? l : { ...l, [c.id]: l[c.id] + 1 }));
    const count = await addLike(EVENT_ID, c.id);
    if (count !== null) setLikes((l) => ({ ...l, [c.id]: count }));
  };

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
              onChange={(e) => {
                setName(sanitizeEventName(e.target.value));
                if (status === "failed") setStatus("idle");
              }}
              onKeyDown={(e) => {
                // IME 조합을 확정하는 Enter(한글·일본어)는 생성이 아니다.
                if (e.key === "Enter" && !e.nativeEvent.isComposing && trimmed && !bundle) {
                  void onGenerate();
                }
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

          {/* 2. 인물 캐러셀 */}
          <h3 className="t-h3 mt-10 text-text">{t("studio.voiceLabel")}</h3>
          <div className="card mt-3 flex items-center gap-2 p-3 sm:gap-4 sm:p-4">
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
          </div>
          {/* 몇 번째인지. 점은 읽히지 않는다 — 이름과 이전/다음 라벨이 이미 말한다. */}
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

          {/* 3. 생성하기 또는 결과. 스크린리더에는 결과가 생긴 순간 제목 문장이 한 번 읽힌다
              (role=status 는 항상 있고 내용만 바뀐다). */}
          <p role="status" className="sr-only">
            {bundle ? t("studio.resultsHeading", { celebrity: nameOf(celebrity) }) : ""}
          </p>
          {bundle ? (
            <div ref={resultsRef} className="mt-8 scroll-mt-24">
              <h3 className="t-h3 text-text">
                {t("studio.resultsHeading", { celebrity: nameOf(celebrity) })}
              </h3>
              <ul className="mt-3 flex flex-col gap-3">
                {MESSAGE_KINDS.map((kind, i) => {
                  const id = playIdFor(kind);
                  const playing = activeId === id;
                  return (
                    <li
                      key={kind}
                      className={`card p-5 transition-[border-color] duration-200 ease-[var(--ease-ui)] ${
                        playing ? "border-accent" : ""
                      }`}
                    >
                      <p className="t-caption font-semibold text-text-muted">
                        {t(`studio.kinds.${kind}.name`)}
                      </p>
                      <p className="t-body mt-1.5 text-text-body [overflow-wrap:anywhere]">
                        {t.rich(`studio.kinds.${kind}.line`, {
                          name: trimmed,
                          b: (chunks) => <span className="font-bold text-text">{chunks}</span>,
                        })}
                      </p>
                      <div className="mt-4 flex items-center gap-2">
                        <motion.button
                          ref={i === 0 ? firstPlayRef : undefined}
                          type="button"
                          onClick={() => (playing ? stop() : play(id, bundle[kind]))}
                          aria-label={
                            playing
                              ? t("studio.stopAria", { celebrity: nameOf(celebrity) })
                              : t("studio.playAria", { celebrity: nameOf(celebrity) })
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
                            <Play className="ml-0.5 h-4 w-4 fill-current" aria-hidden="true" />
                          )}
                          <span>{playing ? t("studio.stop") : t("studio.play")}</span>
                        </motion.button>
                        <motion.button
                          type="button"
                          onClick={() => setDownload({ kind })}
                          aria-label={t("studio.download")}
                          whileTap={tap}
                          transition={spring}
                          className="inline-grid h-14 w-14 shrink-0 place-items-center rounded-[var(--radius-pill)] border border-line bg-surface text-text transition-[background-color] duration-150 ease-[var(--ease-ui)] hover:bg-raised"
                        >
                          <Download className="h-5 w-5" aria-hidden="true" />
                        </motion.button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <div className="mt-8">
              <motion.button
                type="button"
                onClick={() => void onGenerate()}
                disabled={!trimmed || status === "generating"}
                aria-busy={status === "generating" || undefined}
                whileTap={trimmed ? tap : undefined}
                transition={spring}
                className="btn btn-primary w-full gap-2 disabled:cursor-default disabled:opacity-40"
              >
                {status === "generating" ? (
                  <span
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
                  />
                ) : null}
                <span>{status === "generating" ? t("studio.generating") : t("studio.generate")}</span>
              </motion.button>
              {status === "failed" ? (
                <p role="alert" className="t-caption mt-3 text-center text-text">
                  {t("studio.failed")}
                </p>
              ) : null}
            </div>
          )}

          {unsupported ? (
            <p role="alert" className="t-caption mt-6 text-center text-text">
              {t("studio.unsupported")}
            </p>
          ) : null}

          <p className="t-caption mt-10 text-center text-text-muted">{t("studio.disclaimer")}</p>
        </div>
      </div>

      <DownloadDialog
        open={download !== null}
        src={download && bundle ? downloadableSrc(bundle[download.kind]) : null}
        fileName={
          download ? `alarmtalk-${celebrity.id}-${download.kind}-${trimmed}.mp3` : "alarmtalk.mp3"
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
