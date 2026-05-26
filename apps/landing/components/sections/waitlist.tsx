"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

type Status = "idle" | "loading" | "success" | "error";

export function Waitlist() {
  const t = useTranslations("waitlist");
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
        <div className="card-raised relative overflow-hidden p-10 sm:p-14">
          <div
            aria-hidden="true"
            className="absolute -right-32 -top-32 h-80 w-80 rounded-full bg-accent/15 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="absolute -bottom-32 -left-32 h-80 w-80 rounded-full bg-indigo-deep/40 blur-3xl"
          />

          <div className="relative grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div>
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
              <div className="flex flex-col gap-2 sm:flex-row">
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
                <button
                  type="submit"
                  disabled={status === "loading" || status === "success"}
                  className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {status === "loading" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : status === "success" ? (
                    <>
                      <Check className="mr-2 h-4 w-4" />
                      {t("ctaSuccess")}
                    </>
                  ) : (
                    <>
                      {t("cta")}
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </button>
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
        </div>
      </div>
    </section>
  );
}
