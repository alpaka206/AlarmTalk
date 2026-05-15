import { useTranslations } from "next-intl";

export function Trust() {
  const t = useTranslations("trust");
  const items = [0, 1, 2] as const;

  return (
    <section className="relative">
      <div className="mx-auto max-w-6xl px-5 py-16 md:px-8 lg:py-20">
        <h2 className="max-w-2xl text-[28px] font-bold leading-[1.18] tracking-[-0.02em] text-text sm:text-[36px]">
          {t("headline")}
        </h2>

        <div className="mt-10 grid gap-px overflow-hidden rounded-3xl border border-line bg-line lg:grid-cols-3">
          {items.map((i) => (
            <div key={i} className="flex flex-col gap-4 bg-surface p-7 lg:p-8">
              <div className="flex items-baseline gap-1.5">
                <span className="whitespace-nowrap text-[48px] font-bold leading-none tracking-[-0.03em] text-accent sm:text-[56px]">
                  {t(`items.${i}.metric`)}
                </span>
                <span className="whitespace-nowrap text-[14px] font-semibold text-text-muted">
                  {t(`items.${i}.title`)}
                </span>
              </div>
              <p className="text-[14.5px] leading-[1.65] text-text-muted">
                {t(`items.${i}.body`)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
