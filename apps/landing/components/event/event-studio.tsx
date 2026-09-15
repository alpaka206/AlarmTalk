"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Download, Heart, Play, Square } from "lucide-react";
import { motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { usePrefersReducedMotion } from "../motion/use-prefers-reduced-motion";
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
 * 이벤트 1 — 세 단계를 위에서 아래로 흐른다(2026-09-15 지시: 인물 먼저, 단계별로).
 *
 *   1. 누구 목소리로 들을까요?   인물 카드 중 하나를 고른다(카드마다 좋아요).
 *   2. 어떤 메시지를 들을까요?   생일 축하 / 위로 한마디.
 *   3. 이름을 입력해 주세요.      이름을 적으면 만들기가 켜진다.
 *   → 만들기                     결과 카드: 문장 · 듣기/멈춤 · 다운로드 · 좋아요.
 *
 * 다음 단계는 앞 단계를 마쳐야 열린다. 미리 다 보이되 잠겨 있어 "다음에 뭘 하는지" 는 보이고
 * 순서는 강제된다(아무 데나 누르다 만들기가 왜 안 눌리는지 모르는 상태를 만들지 않는다).
 * 셋 중 하나라도 바꾸면 결과는 사라진다 — 다른 조합으로 만든 소리를 지금 조합인 것처럼
 * 들려주지 않는다.
 *
 * 문구는 `t.rich` 로 이름 자리만 강조하고 사용자가 친 값은 값으로만 들어간다. 생성·좋아요는
 * `event-api.ts` 만 안다. 재생은 언제나 하나.
 */
type Status = "idle" | "generating" | "ready" | "failed";

type Result = {
  key: string;
  celebrity: Celebrity;
  kind: MessageKind;
  name: string;
  playback: EventPlayback;
};

const RESULT_ID = "event-result";

export function EventStudio() {
  const t = useTranslations("event");
  const locale = useLocale();
  const reduced = usePrefersReducedMotion();
  const uid = useId();
  const [celebrityId, setCelebrityId] = useState<string | null>(null);
  const [kind, setKind] = useState<MessageKind | null>(null);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<Result | null>(null);
  const [likes, setLikes] = useState<Record<string, LikeState>>({});
  const [downloadOpen, setDownloadOpen] = useState(false);
  const { activeId, play, stop, unsupported } = useEventPlayer();

  const celebrity = CELEBRITIES.find((c) => c.id === celebrityId) ?? null;
  const trimmed = name.trim();
  const nameLength = Array.from(name).length;
  const canGenerate = celebrity !== null && kind !== null && trimmed.length > 0;
  /** 결과는 (인물, 메시지, 이름) 셋에 묶인다. 하나라도 바뀌면 다른 키 → 결과 없음. */
  const key = celebrity && kind ? `${celebrity.id}:${kind}:${trimmed}` : "";
  const current = result && result.key === key ? result : null;
  const playing = current !== null && activeId === RESULT_ID;
  const nameOf = (c: Celebrity) => t(`celebrities.${c.id}.name`);

  // 좋아요는 브라우저가 기억한 것을 하이드레이션 뒤에 읽는다(서버와 첫 그림을 같게).
  useEffect(() => {
    setLikes(loadLikes(CELEBRITIES.map((c) => c.id)));
  }, []);

  // 결과가 사라지면(조합을 바꿈) 소리도 멈춘다 — 화면에 없는 것이 계속 말하면 안 된다.
  useEffect(() => {
    if (current === null && activeId === RESULT_ID) stop();
  }, [current, activeId, stop]);

  // 읽어 줄 문장은 태그를 벗긴 **문자열**이어야 한다 — 화면용 `t.rich` 와 같은 메시지를
  // `t.markup` 으로 풀어 쓴다(`<b>` 는 강조 표시일 뿐 소리에는 없다).
  const lineText = (k: MessageKind, n: string) =>
    t.markup(`studio.kinds.${k}.line`, { name: n, b: (chunks) => chunks });

  const onGenerate = async () => {
    if (!celebrity || !kind || !canGenerate) return;
    setStatus("generating");
    try {
      const playback = await generateVoiceMessage({
        celebrity,
        kind,
        text: lineText(kind, trimmed),
        locale,
      });
      setResult({ key, celebrity, kind, name: trimmed, playback });
      setStatus("ready");
      play(RESULT_ID, playback);
    } catch {
      setStatus("failed");
    }
  };

  const onLike = async (c: Celebrity) => {
    const next = !likes[c.id]?.liked;
    setLikes((l) => ({ ...l, [c.id]: { ...l[c.id], liked: next } }));
    const saved = await toggleLike(c.id, next);
    setLikes((l) => ({ ...l, [c.id]: saved }));
  };

  const tap = reduced ? undefined : { scale: 0.96 };
  const spring = { type: "spring" as const, duration: 0.3, bounce: 0 };
  const step2Open = celebrity !== null;
  const step3Open = step2Open && kind !== null;

  return (
    <section className="relative" aria-labelledby={`${uid}-h`}>
      <div className="mx-auto max-w-site px-5 pb-24 md:px-8 lg:pb-32">
        <div className="mx-auto max-w-[640px]">
          <h2 id={`${uid}-h`} className="sr-only">
            {t("studio.voiceLabel")}
          </h2>

          {/* 1. 인물 */}
          <Step n={1} title={t("studio.voiceLabel")} done={celebrity !== null} open>
            <ul className="grid gap-3 sm:grid-cols-2">
              {CELEBRITIES.map((c) => {
                const selected = c.id === celebrityId;
                const liked = likes[c.id]?.liked ?? false;
                return (
                  <li
                    key={c.id}
                    className={`relative flex items-center gap-3 rounded-[var(--radius-lg)] border p-3 pr-2 transition-[border-color,background-color] duration-150 ease-[var(--ease-ui)] has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-accent ${
                      selected ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-text-dim"
                    }`}
                  >
                    {/* 라벨이 카드 전체를 덮는다(absolute inset-0). 좋아요 버튼은 그 위(z)에 따로 선다. */}
                    <label className="absolute inset-0 cursor-pointer rounded-[inherit]">
                      <input
                        type="radio"
                        name={`${uid}-voice`}
                        value={c.id}
                        checked={selected}
                        onChange={() => setCelebrityId(c.id)}
                        aria-label={t("studio.voiceAria", { celebrity: nameOf(c) })}
                        className="sr-only"
                      />
                    </label>
                    <Portrait src={c.portrait} name={nameOf(c)} alt={t(`celebrities.${c.id}.portraitAlt`)} />
                    <span
                      className={`min-w-0 flex-1 truncate text-[16px] font-bold ${
                        selected ? "text-accent" : "text-text"
                      }`}
                    >
                      {nameOf(c)}
                    </span>
                    <span
                      aria-hidden="true"
                      className={`grid h-5 w-5 shrink-0 place-items-center rounded-[var(--radius-pill)] border ${
                        selected ? "border-accent bg-accent text-white" : "border-line bg-surface"
                      }`}
                    >
                      {selected ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                    </span>
                    <LikeButton liked={liked} count={likes[c.id]?.count} onClick={() => void onLike(c)} />
                  </li>
                );
              })}
            </ul>
          </Step>

          {/* 2. 메시지 종류 */}
          <Step n={2} title={t("studio.kindLabel")} done={kind !== null} open={step2Open}>
            <div className="grid gap-3 sm:grid-cols-2">
              {MESSAGE_KINDS.map((k) => {
                const selected = k === kind;
                return (
                  <label
                    key={k}
                    className={`relative flex h-14 items-center rounded-[var(--radius-lg)] border px-4 transition-[border-color,background-color] duration-150 ease-[var(--ease-ui)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
                      step2Open ? "cursor-pointer" : ""
                    } ${selected ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-text-dim"}`}
                  >
                    <input
                      type="radio"
                      name={`${uid}-kind`}
                      value={k}
                      checked={selected}
                      disabled={!step2Open}
                      onChange={() => setKind(k)}
                      className="sr-only"
                    />
                    <span className="flex w-full items-center justify-between gap-3">
                      <span className={`text-[15.5px] font-bold ${selected ? "text-accent" : "text-text"}`}>
                        {t(`studio.kinds.${k}.name`)}
                      </span>
                      <span
                        aria-hidden="true"
                        className={`grid h-5 w-5 shrink-0 place-items-center rounded-[var(--radius-pill)] border ${
                          selected ? "border-accent bg-accent text-white" : "border-line bg-surface"
                        }`}
                      >
                        {selected ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </Step>

          {/* 3. 이름 + 만들기 */}
          <Step
            n={3}
            title={t("studio.nameLabel")}
            done={trimmed.length > 0}
            open={step3Open}
            htmlFor={`${uid}-name`}
          >
            <div className="relative">
              <input
                id={`${uid}-name`}
                type="text"
                name="eventName"
                inputMode="text"
                autoComplete="given-name"
                autoCapitalize="words"
                spellCheck={false}
                enterKeyHint="done"
                disabled={!step3Open}
                aria-describedby={`${uid}-count`}
                value={name}
                onChange={(e) => setName(sanitizeEventName(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canGenerate && status !== "generating" && !current) {
                    void onGenerate();
                  }
                }}
                placeholder={t("studio.namePlaceholder")}
                className="h-14 w-full rounded-[var(--radius-lg)] border border-line bg-surface px-5 pr-16 text-[18px] font-semibold text-text placeholder:font-medium placeholder:text-text-muted focus-visible:border-accent disabled:bg-bg-alt"
              />
              <span
                id={`${uid}-count`}
                aria-live="polite"
                className={`pointer-events-none absolute inset-y-0 right-5 grid place-items-center text-[12px] tabular-nums ${
                  nameLength >= EVENT_NAME_MAX_LENGTH ? "text-rose" : "text-text-muted"
                }`}
              >
                {nameLength}/{EVENT_NAME_MAX_LENGTH}
              </span>
            </div>

            <motion.button
              type="button"
              onClick={() => void onGenerate()}
              disabled={!canGenerate || status === "generating" || current !== null}
              aria-busy={status === "generating" || undefined}
              whileTap={canGenerate ? tap : undefined}
              transition={spring}
              className="btn btn-primary mt-4 w-full gap-2 disabled:cursor-default disabled:opacity-40"
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
              <p role="alert" className="t-caption mt-3 text-rose">
                {t("studio.failed")}
              </p>
            ) : null}
          </Step>

          {/* 결과 */}
          {current ? (
            <div
              className={`card mt-8 p-6 transition-[border-color] duration-200 ease-[var(--ease-ui)] ${
                playing ? "border-accent" : ""
              }`}
              aria-live="polite"
            >
              <div className="flex items-center gap-3">
                <Portrait
                  src={current.celebrity.portrait}
                  name={nameOf(current.celebrity)}
                  alt={t(`celebrities.${current.celebrity.id}.portraitAlt`)}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[16px] font-bold text-text">{nameOf(current.celebrity)}</p>
                  <p className="t-caption mt-0.5 text-text-muted">{t(`studio.kinds.${current.kind}.name`)}</p>
                </div>
                <LikeButton
                  liked={likes[current.celebrity.id]?.liked ?? false}
                  count={likes[current.celebrity.id]?.count}
                  onClick={() => void onLike(current.celebrity)}
                />
              </div>

              <p className="t-body mt-5 text-text-body">
                {t.rich(`studio.kinds.${current.kind}.line`, {
                  name: current.name,
                  b: (chunks) => <span className="font-bold text-text">{chunks}</span>,
                })}
              </p>

              <div className="mt-5 flex items-center gap-2">
                <motion.button
                  type="button"
                  onClick={() => (playing ? stop() : play(RESULT_ID, current.playback))}
                  aria-label={
                    playing
                      ? t("studio.stopAria", { celebrity: nameOf(current.celebrity) })
                      : t("studio.playAria", { celebrity: nameOf(current.celebrity) })
                  }
                  whileTap={tap}
                  transition={spring}
                  className={`btn btn-primary flex-1 gap-2 ${playing ? "bg-text hover:bg-gray-800" : ""}`}
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
                  onClick={() => setDownloadOpen(true)}
                  aria-label={t("studio.download")}
                  whileTap={tap}
                  transition={spring}
                  className="inline-grid h-14 w-14 shrink-0 place-items-center rounded-[var(--radius-pill)] border border-line bg-surface text-text transition-[background-color] duration-150 ease-[var(--ease-ui)] hover:bg-raised"
                >
                  <Download className="h-5 w-5" aria-hidden="true" />
                </motion.button>
              </div>
              <p className="t-caption mt-3 min-h-[1.2em] text-text-muted">
                {playing ? t("studio.playing") : t("studio.ready")}
              </p>
            </div>
          ) : null}

          {unsupported ? (
            <p role="alert" className="t-caption mt-6 text-center text-rose">
              {t("studio.unsupported")}
            </p>
          ) : null}

          <p className="t-caption mt-10 text-center text-text-muted">{t("studio.disclaimer")}</p>
        </div>
      </div>

      <DownloadDialog
        open={downloadOpen}
        src={current ? downloadableSrc(current.playback) : null}
        fileName={
          current ? `alarmtalk-${current.celebrity.id}-${current.kind}-${current.name}.mp3` : "alarmtalk.mp3"
        }
        onClose={() => setDownloadOpen(false)}
      />
    </section>
  );
}

/**
 * 단계 하나: 번호 · 제목 · 내용. 앞 단계를 마쳐야 열린다(`open`). 잠긴 단계는 흐리게 두고 안의
 * 입력은 각자 `disabled` 다 — 화면에서 사라지지 않아 다음에 뭘 하는지는 보인다.
 * 번호는 마치면 체크로 바뀐다(진행 표시).
 */
function Step({
  n,
  title,
  done,
  open,
  htmlFor,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  open: boolean;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset
      aria-disabled={!open || undefined}
      className={`mt-9 transition-opacity duration-200 ease-[var(--ease-ui)] first:mt-0 ${
        open ? "" : "opacity-40"
      }`}
    >
      <legend className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-pill)] text-[13px] font-bold tabular-nums ${
            done ? "bg-accent text-white" : open ? "bg-accent-soft text-accent" : "bg-raised text-text-muted"
          }`}
        >
          {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : n}
        </span>
        <span className="t-h3 text-text">{htmlFor ? <label htmlFor={htmlFor}>{title}</label> : title}</span>
      </legend>
      <div className="mt-4">{children}</div>
    </fieldset>
  );
}

function LikeButton({ liked, count, onClick }: { liked: boolean; count?: number; onClick: () => void }) {
  const t = useTranslations("event.studio");
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={liked}
      aria-label={liked ? t("liked") : t("like")}
      className={`relative z-10 inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[var(--radius-pill)] border px-3 text-[13.5px] font-semibold transition-[background-color,border-color,color] duration-150 ease-[var(--ease-ui)] ${
        liked ? "border-rose/40 bg-rose/10 text-rose" : "border-line bg-surface text-text-muted hover:text-text"
      }`}
    >
      <Heart className={`h-4 w-4 ${liked ? "fill-current" : ""}`} aria-hidden="true" />
      {count !== undefined ? <span className="tabular-nums">{count}</span> : null}
    </button>
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
        className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-surface text-[18px] font-bold text-accent ring-1 ring-line"
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
      width={48}
      height={48}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-12 w-12 shrink-0 rounded-full object-cover ring-1 ring-line"
    />
  );
}
