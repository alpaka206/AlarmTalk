"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { StoreBadges } from "../store-badges";

/**
 * 다운로드를 누르면 먼저 뜨는 창 — "이런 목소리를 더 듣고 싶으신가요?" 와 앱 링크, 그리고
 * 그냥 받는 길. 파일을 막는 게 아니라 **한 번 권하는 것**이라 두 번째 버튼이 항상 있다.
 *
 * 네이티브 `<dialog>` 다(모바일 메뉴와 같은 이유: 포커스 트랩·top layer·Escape 를 브라우저가
 * 맡는다). 항상 마운트돼 있고 `open` 으로 `showModal()`/`close()` 만 한다.
 *
 * `src` 가 없으면(합성 음성이라 파일이 없거나, mp3 를 아직 만드는 중) "그냥 다운로드" 는
 * 눌리지 않는다 — 눌렀는데 아무 일도 없는 버튼을 두지 않는다.
 */
export function DownloadDialog({
  open,
  src,
  fileName,
  onClose,
}: {
  open: boolean;
  src: string | null;
  fileName: string;
  onClose: () => void;
}) {
  const t = useTranslations("event.downloadModal");
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="event-download-title"
      onClose={onClose}
      // 뒷배경 클릭으로 닫기: dialog 자체가 클릭 대상이면(안쪽 패널 밖) 닫는다.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-auto w-[calc(100%-2.5rem)] max-w-md overscroll-contain rounded-[var(--radius-3xl)] border border-line bg-surface p-0 text-text shadow-[var(--shadow-elevated)] backdrop:bg-ink/55"
    >
      <div className="relative px-6 pb-6 pt-7 sm:px-8 sm:pb-8 sm:pt-9">
        <button
          type="button"
          aria-label={t("close")}
          onClick={onClose}
          className="absolute right-4 top-4 inline-grid h-9 w-9 place-items-center rounded-full text-text-muted transition-[background-color,color] duration-150 ease-[var(--ease-ui)] hover:bg-raised hover:text-text"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>

        <h2 id="event-download-title" className="t-h2 pr-8 text-text">
          {t("title")}
        </h2>
        <p className="t-body mt-3 whitespace-pre-line text-text-body">{t("body")}</p>

        <div className="mt-6">
          <StoreBadges className="justify-start" />
        </div>

        <div className="mt-5 border-t border-line pt-5">
          {src ? (
            <a
              href={src}
              download={fileName}
              onClick={onClose}
              className="btn btn-secondary w-full"
            >
              {t("secondary")}
            </a>
          ) : (
            <button type="button" disabled className="btn btn-secondary w-full opacity-50">
              {t("secondary")}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
