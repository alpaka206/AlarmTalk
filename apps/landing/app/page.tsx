"use client";

import { useEffect } from "react";
import { routing } from "@/i18n/routing";

export default function RootPage() {
  useEffect(() => {
    window.location.replace(`/${routing.defaultLocale}/`);
  }, []);

  return (
    <main className="grid min-h-[60vh] place-items-center text-text-muted">
      <a href={`/${routing.defaultLocale}/`} className="underline">
        AlarmTalk
      </a>
    </main>
  );
}
