"use client";

import { useId, useState } from "react";
import { Play, Square } from "lucide-react";
import { motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { usePrefersReducedMotion } from "../motion/use-prefers-reduced-motion";
import { RevealGroup, RevealItem } from "../motion/reveal-group";
import { resolveCheerPlayback } from "./cheer-playback";
import {
  CHEER_NAME_MAX_LENGTH,
  CHEER_VOICES,
  sanitizeCheerName,
  type CheerVoice,
} from "./cheer-voices";
import { useCheerPlayer } from "./use-cheer-player";

/**
 * 응원 메시지 — 이름 하나 적으면 목소리마다 그 이름을 부르며 응원해 준다.
 *
 * 화면에 있는 것은 **이름 칸과 재생 버튼**뿐이다. 문장은 카드가 미리 보여 주고(이름을
 * 적는 대로 바뀐다), 누르면 그대로 읽는다. 재생은 언제나 하나이고, 다른 카드를 누르면
 * 앞 것이 바로 끊긴다.
 *
 * 문구는 `t.rich` 로 이름 자리만 강조한다 — 사용자가 친 값은 값으로만 들어간다.
 */
export function CheerStudio() {
  const t = useTranslations("cheer");
  const locale = useLocale();
  const reduced = usePrefersReducedMotion();
  const inputId = useId();
  const [name, setName] = useState("");
  const { activeId, play, stop, unsupported } = useCheerPlayer();

  const displayName = name.trim() || t("studio.namePlaceholderInline");
  const nameLength = Array.from(name).length;

  // 읽어 줄 문장은 태그를 벗긴 **문자열**이어야 한다 — 화면용 `t.rich` 와 같은 메시지를
  // `t.markup` 으로 풀어 쓴다(`<b>` 는 강조 표시일 뿐 소리에는 없다).
  const lineFor = (voice: CheerVoice) =>
    t.markup(`voices.${voice.id}.line`, {
      name: displayName,
      b: (chunks) => chunks,
    });

  const onPress = (voice: CheerVoice) => {
    if (activeId === voice.id) {
      stop();
      return;
    }
    play(voice.id, resolveCheerPlayback(voice, lineFor(voice), locale));
  };

  return (
    <section className="relative" aria-labelledby={`${inputId}-heading`}>
      <div className="mx-auto max-w-6xl px-5 pb-24 md:px-8 lg:pb-32">
        <div className="mx-auto max-w-[560px]">
          <label
            id={`${inputId}-heading`}
            htmlFor={inputId}
            className="t-h3 block text-text"
          >
            {t("studio.nameLabel")}
          </label>
          <div className="relative mt-3">
            <input
              id={inputId}
              type="text"
              inputMode="text"
              autoComplete="given-name"
              enterKeyHint="done"
              value={name}
              onChange={(e) => setName(sanitizeCheerName(e.target.value))}
              placeholder={t("studio.namePlaceholder")}
              className="h-14 w-full rounded-[var(--radius-lg)] border border-line bg-surface px-5 pr-16 text-[18px] font-semibold text-text placeholder:font-medium placeholder:text-text-dim focus:border-accent focus:outline-none"
            />
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute inset-y-0 right-5 grid place-items-center text-[12px] tabular-nums ${
                nameLength >= CHEER_NAME_MAX_LENGTH ? "text-rose" : "text-text-dim"
              }`}
            >
              {nameLength}/{CHEER_NAME_MAX_LENGTH}
            </span>
          </div>
          <p className="t-caption mt-3 text-text-muted">{t("studio.nameHint")}</p>
        </div>

        <RevealGroup
          as="ul"
          className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          stagger={0.06}
        >
          {CHEER_VOICES.map((voice) => {
            const playing = activeId === voice.id;
            const voiceName = t(`voices.${voice.id}.name`);
            return (
              <RevealItem
                as="li"
                key={voice.id}
                className={`card flex flex-col p-6 transition-[border-color] duration-200 ease-[var(--ease-ui)] ${
                  playing ? "border-accent" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <span className="inline-flex items-center rounded-[var(--radius-pill)] bg-accent-soft px-2.5 py-1 text-[11.5px] font-semibold text-accent">
                      {t(`voices.${voice.id}.role`)}
                    </span>
                    <h3 className="t-h3 mt-3 truncate text-text">{voiceName}</h3>
                  </div>
                  <motion.button
                    type="button"
                    onClick={() => onPress(voice)}
                    aria-pressed={playing}
                    aria-label={
                      playing
                        ? t("studio.stopAria", { voice: voiceName })
                        : t("studio.playAria", { voice: voiceName })
                    }
                    whileTap={reduced ? undefined : { scale: 0.94 }}
                    transition={{ type: "spring", duration: 0.3, bounce: 0 }}
                    className={`grid h-12 w-12 shrink-0 place-items-center rounded-full text-white transition-[background-color] duration-150 ease-[var(--ease-ui)] ${
                      playing ? "bg-text hover:bg-gray-800" : "bg-accent hover:bg-accent-strong"
                    }`}
                  >
                    {playing ? (
                      <Square className="h-4 w-4 fill-current" aria-hidden="true" />
                    ) : (
                      <Play className="ml-0.5 h-5 w-5 fill-current" aria-hidden="true" />
                    )}
                  </motion.button>
                </div>

                <p className="t-body mt-5 text-text-body">
                  {t.rich(`voices.${voice.id}.line`, {
                    name: displayName,
                    b: (chunks) => (
                      <span className="font-bold text-text">{chunks}</span>
                    ),
                  })}
                </p>

                <p className="t-caption mt-auto pt-5 text-text-muted" aria-live="polite">
                  {playing ? t("studio.playing") : t(`voices.${voice.id}.style`)}
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
    </section>
  );
}
