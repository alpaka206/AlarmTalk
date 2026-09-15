"use client";

import { useEffect, useId, useState } from "react";
import { Download, Heart, Play, Sparkles, Square } from "lucide-react";
import { motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { usePrefersReducedMotion } from "../motion/use-prefers-reduced-motion";
import { RevealGroup, RevealItem } from "../motion/reveal-group";
import { DownloadDialog } from "./download-dialog";
import {
  downloadableSrc,
  generateVoiceMessage,
  loadLikes,
  toggleLike,
  type EventPlayback,
  type LikeState,
} from "./event-api";
import {
  CELEBRITIES,
  EVENT_NAME_MAX_LENGTH,
  MESSAGE_KINDS,
  sanitizeEventName,
  type Celebrity,
  type MessageKind,
} from "./event-catalog";
import { useEventPlayer } from "./use-event-player";

/**
 * 이벤트 1 — 이름을 적고, 메시지를 고르고, 좋아하는 목소리 카드에서 **만들기**를 누르면 그
 * 이름을 부르는 음성 메시지가 생긴다. 들어 보고, 마음에 들면 좋아요와 다운로드.
 *
 * 순서가 곧 화면이다: 이름 → 메시지 종류 → 인물 카드. 카드는 인물마다 하나이고 그 안에서
 * 상태가 흐른다(만들기 → 만드는 중 → 듣기/멈춤 + 다운로드). 이름이나 메시지를 바꾸면 만든 것은
 * 무효가 되므로 카드가 처음 상태로 돌아간다 — 다른 이름으로 만든 소리를 지금 이름인 것처럼
 * 들려주지 않는다.
 *
 * 재생은 언제나 하나. 다른 카드를 누르면 앞 것이 바로 끊긴다. 문구는 `t.rich` 로 이름 자리만
 * 강조하고 사용자가 친 값은 값으로만 들어간다. 생성·좋아요는 `event-api.ts` 만 안다.
 */
type CardStatus = "idle" | "generating" | "ready" | "failed";

type Generated = { key: string; playback: EventPlayback };

export function EventStudio() {
  const t = useTranslations("event");
  const locale = useLocale();
  const reduced = usePrefersReducedMotion();
  const inputId = useId();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<MessageKind>(MESSAGE_KINDS[0]);
  const [generated, setGenerated] = useState<Record<string, Generated>>({});
  const [status, setStatus] = useState<Record<string, CardStatus>>({});
  const [likes, setLikes] = useState<Record<string, LikeState>>({});
  const [download, setDownload] = useState<{ celebrity: Celebrity } | null>(null);
  const { activeId, play, stop, unsupported } = useEventPlayer();

  const displayName = name.trim() || t("studio.namePlaceholderInline");
  const nameLength = Array.from(name).length;
  /** 만든 소리는 (인물, 메시지, 이름) 셋에 묶인다. 하나라도 바뀌면 다른 키다. */
  const keyFor = (c: Celebrity) => `${c.id}:${kind}:${displayName}`;

  // 좋아요는 브라우저가 기억한 것을 하이드레이션 뒤에 읽는다(서버와 첫 그림을 같게).
  useEffect(() => {
    setLikes(loadLikes(CELEBRITIES.map((c) => c.id)));
  }, []);

  // 읽어 줄 문장은 태그를 벗긴 **문자열**이어야 한다 — 화면용 `t.rich` 와 같은 메시지를
  // `t.markup` 으로 풀어 쓴다(`<b>` 는 강조 표시일 뿐 소리에는 없다).
  const lineText = () =>
    t.markup(`studio.kinds.${kind}.line`, { name: displayName, b: (chunks) => chunks });

  const statusOf = (c: Celebrity): CardStatus => {
    if (status[c.id] === "generating" || status[c.id] === "failed") return status[c.id];
    return generated[c.id]?.key === keyFor(c) ? "ready" : "idle";
  };

  const onGenerate = async (c: Celebrity) => {
    const key = keyFor(c);
    setStatus((s) => ({ ...s, [c.id]: "generating" }));
    try {
      const playback = await generateVoiceMessage({ celebrity: c, kind, text: lineText(), locale });
      setGenerated((g) => ({ ...g, [c.id]: { key, playback } }));
      setStatus((s) => ({ ...s, [c.id]: "ready" }));
      play(c.id, playback);
    } catch {
      setStatus((s) => ({ ...s, [c.id]: "failed" }));
    }
  };

  const onPress = (c: Celebrity) => {
    const st = statusOf(c);
    if (activeId === c.id) return stop();
    if (st === "ready") return play(c.id, generated[c.id].playback);
    if (st !== "generating") void onGenerate(c);
  };

  const onLike = async (c: Celebrity) => {
    const next = !likes[c.id]?.liked;
    setLikes((l) => ({ ...l, [c.id]: { ...l[c.id], liked: next } }));
    const saved = await toggleLike(c.id, next);
    setLikes((l) => ({ ...l, [c.id]: saved }));
  };

  const tap = reduced ? undefined : { scale: 0.96 };
  const spring = { type: "spring" as const, duration: 0.3, bounce: 0 };

  return (
    <section className="relative" aria-labelledby={`${inputId}-heading`}>
      <div className="mx-auto max-w-site px-5 pb-24 md:px-8 lg:pb-32">
        {/* 1. 이름 */}
        <div className="mx-auto max-w-[560px]">
          <h2 id={`${inputId}-heading`} className="t-h3 text-text">
            <label htmlFor={inputId}>{t("studio.nameLabel")}</label>
          </h2>
          <div className="relative mt-3">
            <input
              id={inputId}
              type="text"
              name="eventName"
              inputMode="text"
              autoComplete="given-name"
              autoCapitalize="words"
              spellCheck={false}
              enterKeyHint="done"
              aria-describedby={`${inputId}-hint ${inputId}-count`}
              value={name}
              onChange={(e) => setName(sanitizeEventName(e.target.value))}
              placeholder={t("studio.namePlaceholder")}
              className="h-14 w-full rounded-[var(--radius-lg)] border border-line bg-surface px-5 pr-16 text-[18px] font-semibold text-text placeholder:font-medium placeholder:text-text-muted focus-visible:border-accent"
            />
            <span
              id={`${inputId}-count`}
              aria-live="polite"
              className={`pointer-events-none absolute inset-y-0 right-5 grid place-items-center text-[12px] tabular-nums ${
                nameLength >= EVENT_NAME_MAX_LENGTH ? "text-rose" : "text-text-muted"
              }`}
            >
              {nameLength}/{EVENT_NAME_MAX_LENGTH}
            </span>
          </div>
          <p id={`${inputId}-hint`} className="t-caption mt-3 text-text-muted">
            {t("studio.nameHint", { max: EVENT_NAME_MAX_LENGTH })}
          </p>

          {/* 2. 메시지 종류 — 라디오 그룹을 세그먼트 모양으로. 고른 쪽만 채운다. */}
          <fieldset className="mt-9">
            <legend className="t-h3 text-text">{t("studio.kindLabel")}</legend>
            <div className="mt-3 grid grid-cols-2 gap-1 rounded-[var(--radius-pill)] border border-line bg-bg-alt p-1">
              {MESSAGE_KINDS.map((k) => {
                const selected = k === kind;
                return (
                  <label
                    key={k}
                    className={`relative grid h-11 cursor-pointer place-items-center rounded-[var(--radius-pill)] px-3 text-[14.5px] font-semibold transition-[background-color,color] duration-150 ease-[var(--ease-ui)] ${
                      selected ? "bg-surface text-text shadow-[var(--shadow-hairline)]" : "text-text-muted hover:text-text"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`${inputId}-kind`}
                      value={k}
                      checked={selected}
                      onChange={() => setKind(k)}
                      className="sr-only"
                    />
                    {t(`studio.kinds.${k}.name`)}
                  </label>
                );
              })}
            </div>
          </fieldset>
        </div>

        {/* 3. 인물 카드 */}
        <RevealGroup as="ul" className="mx-auto mt-12 grid max-w-[880px] gap-4 sm:grid-cols-2" stagger={0.06}>
          {CELEBRITIES.map((c) => {
            const celebrityName = t(`celebrities.${c.id}.name`);
            const st = statusOf(c);
            const playing = activeId === c.id;
            const liked = likes[c.id]?.liked ?? false;
            const caption =
              st === "failed"
                ? t("studio.failed")
                : st === "generating"
                  ? t("studio.generating")
                  : playing
                    ? t("studio.playing")
                    : st === "ready"
                      ? t("studio.ready")
                      : "";
            const mainAria = playing
              ? t("studio.stopAria", { celebrity: celebrityName })
              : st === "ready"
                ? t("studio.playAria", { celebrity: celebrityName })
                : t("studio.generateAria", { celebrity: celebrityName });
            return (
              <RevealItem
                as="li"
                key={c.id}
                className={`card flex flex-col p-6 transition-[border-color] duration-200 ease-[var(--ease-ui)] ${
                  playing ? "border-accent" : ""
                }`}
              >
                <div className="flex items-center gap-4">
                  <Portrait src={c.portrait} name={celebrityName} alt={t(`celebrities.${c.id}.portraitAlt`)} />
                  <div className="min-w-0 flex-1">
                    <h3 className="t-h2 truncate text-text">{celebrityName}</h3>
                  </div>
                  {/* 좋아요. 숫자는 서버가 줄 때만 보인다 — 없는 숫자를 지어내지 않는다. */}
                  <motion.button
                    type="button"
                    onClick={() => void onLike(c)}
                    aria-pressed={liked}
                    aria-label={liked ? t("studio.liked") : t("studio.like")}
                    whileTap={tap}
                    transition={spring}
                    className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[var(--radius-pill)] border px-3.5 text-[13.5px] font-semibold transition-[background-color,border-color,color] duration-150 ease-[var(--ease-ui)] ${
                      liked
                        ? "border-rose/40 bg-rose/10 text-rose"
                        : "border-line bg-surface text-text-muted hover:text-text"
                    }`}
                  >
                    <Heart className={`h-4 w-4 ${liked ? "fill-current" : ""}`} aria-hidden="true" />
                    {likes[c.id]?.count !== undefined ? (
                      <span className="tabular-nums">{likes[c.id].count}</span>
                    ) : null}
                  </motion.button>
                </div>

                <p className="t-body mt-5 min-h-[3.3em] text-text-body">
                  {t.rich(`studio.kinds.${kind}.line`, {
                    name: displayName,
                    b: (chunks) => <span className="font-bold text-text">{chunks}</span>,
                  })}
                </p>

                <div className="mt-5 flex items-center gap-2">
                  <motion.button
                    type="button"
                    onClick={() => onPress(c)}
                    aria-label={mainAria}
                    aria-busy={st === "generating" || undefined}
                    whileTap={tap}
                    transition={spring}
                    className={`btn btn-primary flex-1 gap-2 ${
                      playing ? "bg-text hover:bg-gray-800" : ""
                    }`}
                  >
                    {st === "generating" ? (
                      <span
                        aria-hidden="true"
                        className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
                      />
                    ) : playing ? (
                      <Square className="h-4 w-4 fill-current" aria-hidden="true" />
                    ) : st === "ready" ? (
                      <Play className="ml-0.5 h-4 w-4 fill-current" aria-hidden="true" />
                    ) : (
                      <Sparkles className="h-4 w-4" aria-hidden="true" />
                    )}
                    <span>
                      {st === "generating"
                        ? t("studio.generating")
                        : playing
                          ? t("studio.stop")
                          : st === "ready"
                            ? t("studio.play")
                            : t("studio.generate")}
                    </span>
                  </motion.button>
                  {st === "ready" ? (
                    <motion.button
                      type="button"
                      onClick={() => setDownload({ celebrity: c })}
                      aria-label={t("studio.download")}
                      whileTap={tap}
                      transition={spring}
                      className="inline-grid h-14 w-14 shrink-0 place-items-center rounded-[var(--radius-pill)] border border-line bg-surface text-text transition-[background-color] duration-150 ease-[var(--ease-ui)] hover:bg-raised"
                    >
                      <Download className="h-5 w-5" aria-hidden="true" />
                    </motion.button>
                  ) : null}
                </div>

                <p
                  className={`t-caption mt-3 min-h-[1.2em] ${st === "failed" ? "text-rose" : "text-text-muted"}`}
                  aria-live="polite"
                >
                  {caption}
                </p>
              </RevealItem>
            );
          })}
        </RevealGroup>

        {unsupported ? (
          <p role="alert" className="t-caption mt-6 text-center text-rose">
            {t("studio.unsupported")}
          </p>
        ) : null}

        <p className="t-caption mx-auto mt-10 max-w-[560px] text-center text-text-muted">
          {t("studio.disclaimer")}
        </p>
      </div>

      <DownloadDialog
        open={download !== null}
        src={download ? downloadableSrc(generated[download.celebrity.id]?.playback) : null}
        fileName={
          download
            ? `alarmtalk-${download.celebrity.id}-${kind}-${displayName}.mp3`
            : "alarmtalk.mp3"
        }
        onClose={() => setDownload(null)}
      />
    </section>
  );
}

/**
 * 인물 사진. 파일이 없거나 못 불러오면 이니셜 원으로 대신한다 — 깨진 이미지 아이콘을 두지
 * 않는다. 사진은 초상권 허락을 받은 것만 `public/event/` 에 넣는다.
 */
function Portrait({ src, name, alt }: { src: string; name: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span
        role="img"
        aria-label={alt}
        className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-accent-soft text-[22px] font-bold text-accent"
      >
        {Array.from(name)[0] ?? ""}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      width={64}
      height={64}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-16 w-16 shrink-0 rounded-full object-cover ring-1 ring-line"
    />
  );
}
