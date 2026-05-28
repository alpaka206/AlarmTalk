"use client";

import { useEffect } from "react";

export function HtmlLangSync({ locale }: { locale: string }) {
  useEffect(() => {
    if (document.documentElement.lang !== locale) {
      document.documentElement.lang = locale;
    }
  }, [locale]);
  return null;
}
