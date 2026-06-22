"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { motion } from "motion/react";
import { Reveal } from "../motion/reveal";
import { Magnetic } from "../motion/magnetic";
import { LivingWaveform } from "../motion/living-waveform";
import { usePrefersReducedMotion } from "../motion/use-prefers-reduced-motion";

type Status = "idle" | "loading" | "success" | "error";

// short coral flourish — the voice-spine resolving where the journey begins
const SPINE_BARS = [
  0.3, 0.5, 0.4, 0.7, 0.55, 0.85, 0.5, 0.65, 0.9, 0.6, 0.45, 0.7, 0.5, 0.8,
  0.4, 0.6,
];

export function Waitlist() {
  const t = useTranslations("waitlist");
  const reduced = usePrefersReducedMotion();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "loading" || status === "success") return;

    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setStatus("error");
      return;
    }

    setStatus("loading");
    window.setTimeout(() => {
      // eslint-disable-next-line no-console
      console.log("[AlarmTalk waitlist] mock submit:", trimmed);
      setStatus("success");
      setEmail("");
    }, 700);
  }

  return (
    <section id="waitlist" className="relative">
      <div className="mx-auto max-w-5xl px-5 py-24 md:px-8 lg:py-32">
        <Reveal
          as="div"
          variant="focus"
          className="card-raised relative overflow-hidden p-10 sm:p-14"
        >
          <div
            aria-hidden="true"
            className="animate-drift absolute -right-32 -top-32 h-80 w-80 rounded-full bg-accent/15 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="animate-drift-slow absolute -bottom-32 -left-32 h-80 w-80 rounded-full bg-indigo-deep/40 blur-3xl"
          />

          <div className="relative grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div>
              <div className="mb-5 h-6 w-40">
                <LivingWaveform
                  bars={SPINE_BARS}
                  mode="playOnce"
                  color="var(--color-accent)"
                  barWidth="flex"
                  gapPx={3}
                  minPx={2}
                  spanPx={20}
                  align="end"
                />
              </div>
              <h2 className="text-[32px] font-bold leading-[1.12] tracking-[-0.025em] text-text sm:text-[40px]">
                {t("headline1")}
                <br />
                {t("headline2")}
              </h2>
              <p className="mt-6 max-w-md text-[15.5px] leading-[1.65] text-text-muted">
                {t("description")}
              </p>
            </div>

            <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
              <label htmlFor="waitlist-email" className="sr-only">
                Email
              </label>
              <div className="relative flex flex-col gap-2 sm:flex-row">
                <input
                  id="waitlist-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder={t("placeholder")}
                  required
                  value={email}
                  disabled={status === "loading" || status === "success"}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (status === "error") setStatus("idle");
                  }}
                  className="h-[52px] flex-1 rounded-full border border-line bg-bg px-5 text-[15px] text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60"
                />
                <Magnetic>
                  <button
                    type="submit"
                    disabled={status === "loading" || status === "success"}
                    className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {status === "loading" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : status === "success" ? (
                      <>
                        <motion.span
                          className="mr-2 inline-flex"
                          initial={reduced ? false : { scale: 0 }}
                          animate={reduced ? undefined : { scale: 1 }}
                          transition={{ type: "spring", stiffness: 300, damping: 14 }}
                        >
                          <Check className="h-4 w-4" />
                        </motion.span>
                        {t("ctaSuccess")}
                      </>
                    ) : (
                      <>
                        {t("cta")}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </button>
                </Magnetic>

                {/* mint success flash — mint = safe / trusted */}
                {status === "success" && !reduced && (
                  <motion.div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 rounded-full"
                    style={{ backgroundColor: "var(--color-mint)" }}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0, 0.18, 0] }}
                    transition={{ duration: 1, ease: "easeOut" }}
                  />
                )}
              </div>
              <p
                role="status"
                aria-live="polite"
                className="min-h-[20px] text-[13px]"
              >
                {status === "error" && (
                  <span className="text-rose">{t("messageError")}</span>
                )}
                {status === "success" && (
                  <span className="text-mint">{t("messageSuccess")}</span>
                )}
                {(status === "idle" || status === "loading") && (
                  <span className="text-text-faint">{t("agreement")}</span>
                )}
              </p>
            </form>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
