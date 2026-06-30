import type { Metadata } from "next";
import { Mail, Smartphone, ShieldCheck } from "lucide-react";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { routing, type Locale } from "@/i18n/routing";
import { SiteFooter } from "@/components/sections/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SITE_NAME, localeUrl, localePath, languageAlternates } from "@/lib/site";

const PRIVACY_EMAIL = "privacy@alarm-talk.com";

const CONTENT = {
  ko: {
    title: "계정 및 데이터 삭제",
    description:
      "AlarmTalk 계정과 관련 데이터를 삭제하거나 삭제를 요청하는 방법을 안내합니다.",
    eyebrow: "Account deletion",
    headline: "AlarmTalk 계정과 데이터를 삭제할 수 있습니다.",
    intro:
      "앱에서 직접 회원 탈퇴를 진행하거나, 앱에 접근할 수 없는 경우 개인정보 담당자에게 삭제 요청을 보낼 수 있습니다.",
    appTitle: "앱에서 삭제",
    appBody:
      "AlarmTalk 앱을 열고 설정 > 계정 > 회원 탈퇴를 선택하세요. 탈퇴가 완료되면 서버에 저장된 계정 데이터가 삭제 또는 비식별화됩니다.",
    requestTitle: "웹에서 요청",
    requestBody:
      "앱에 로그인할 수 없거나 기기를 사용할 수 없다면 아래 이메일로 삭제 요청을 보내주세요. 본인 확인 후 처리 결과를 안내합니다.",
    mailCta: "삭제 요청 메일 보내기",
    emailSubject: "AlarmTalk 계정 및 데이터 삭제 요청",
    emailBody:
      "AlarmTalk 계정 및 관련 데이터 삭제를 요청합니다.\n\n가입 이메일 또는 로그인 제공자:\n요청 사유(선택):\n",
    scopeTitle: "삭제되는 데이터",
    scopeItems: [
      "계정 식별 정보와 로그인 연결 정보",
      "서버에 동기화된 알람 설정",
      "음성 프로필, 업로드 음성, 생성 음성 및 관련 메타데이터",
      "가족/파트너 연결, 메시지와 이용 기록",
    ],
    retainedTitle: "일부 보관될 수 있는 데이터",
    retainedBody:
      "법령상 보관 의무, 결제 정산, 분쟁 대응, 보안 로그처럼 꼭 필요한 기록은 정해진 기간 동안 제한적으로 보관될 수 있습니다. 기기에 저장된 로컬 알람 파일은 앱 데이터 삭제 또는 알람 삭제로 직접 정리해야 할 수 있습니다.",
    timingTitle: "처리 기준",
    timingBody:
      "본인 확인에 필요한 정보를 받은 뒤 지체 없이 처리합니다. 추가 확인이 필요한 경우 이메일로 연락드립니다.",
  },
  en: {
    title: "Account and Data Deletion",
    description:
      "How to delete or request deletion of your AlarmTalk account and related data.",
    eyebrow: "Account deletion",
    headline: "You can delete your AlarmTalk account and data.",
    intro:
      "You can delete your account in the app, or email our privacy contact if you cannot access the app.",
    appTitle: "Delete in the app",
    appBody:
      "Open AlarmTalk and go to Settings > Account > Delete account. After deletion, account data stored on our servers is deleted or anonymized.",
    requestTitle: "Request on the web",
    requestBody:
      "If you cannot sign in to the app or no longer have access to your device, send a deletion request by email. We will verify ownership and reply with the result.",
    mailCta: "Send deletion request",
    emailSubject: "AlarmTalk account and data deletion request",
    emailBody:
      "I request deletion of my AlarmTalk account and related data.\n\nSign-in email or provider:\nReason (optional):\n",
    scopeTitle: "Data deleted",
    scopeItems: [
      "Account identifiers and sign-in connection data",
      "Alarm settings synchronized to the server",
      "Voice profiles, uploaded voices, generated voices, and related metadata",
      "Family or partner connections, messages, and usage records",
    ],
    retainedTitle: "Data that may be retained",
    retainedBody:
      "Records required for legal retention, payment settlement, dispute handling, or security logs may be kept for a limited period. Local alarm files stored on your device may need to be removed by deleting app data or deleting alarms.",
    timingTitle: "Processing",
    timingBody:
      "After we receive the information needed to verify ownership, we process the request without undue delay. We will email you if additional verification is needed.",
  },
  ja: {
    title: "アカウントとデータの削除",
    description:
      "AlarmTalk のアカウントと関連データを削除、または削除依頼する方法を案内します。",
    eyebrow: "Account deletion",
    headline: "AlarmTalk のアカウントとデータを削除できます。",
    intro:
      "アプリ内でアカウント削除を行うか、アプリにアクセスできない場合はプライバシー窓口へ削除依頼を送信できます。",
    appTitle: "アプリで削除",
    appBody:
      "AlarmTalk アプリを開き、設定 > アカウント > アカウント削除を選択してください。削除後、サーバー上のアカウントデータは削除または匿名化されます。",
    requestTitle: "Web から依頼",
    requestBody:
      "アプリにログインできない場合や端末を利用できない場合は、下記メールアドレスに削除依頼を送ってください。本人確認後、処理結果をご案内します。",
    mailCta: "削除依頼メールを送信",
    emailSubject: "AlarmTalk account and data deletion request",
    emailBody:
      "AlarmTalk アカウントと関連データの削除を依頼します。\n\n登録メールまたはログイン提供元:\n理由（任意）:\n",
    scopeTitle: "削除されるデータ",
    scopeItems: [
      "アカウント識別情報とログイン連携情報",
      "サーバーに同期されたアラーム設定",
      "音声プロフィール、アップロード音声、生成音声と関連メタデータ",
      "家族・パートナー連携、メッセージ、利用記録",
    ],
    retainedTitle: "一部保持される可能性があるデータ",
    retainedBody:
      "法令上の保存義務、決済精算、紛争対応、セキュリティログなど必要な記録は、定められた期間に限り保持される場合があります。端末内のローカルアラームファイルは、アプリデータまたはアラームを削除して整理する必要があります。",
    timingTitle: "処理基準",
    timingBody:
      "本人確認に必要な情報を受け取った後、遅滞なく処理します。追加確認が必要な場合はメールでご連絡します。",
  },
} satisfies Record<Locale, {
  title: string;
  description: string;
  eyebrow: string;
  headline: string;
  intro: string;
  appTitle: string;
  appBody: string;
  requestTitle: string;
  requestBody: string;
  mailCta: string;
  emailSubject: string;
  emailBody: string;
  scopeTitle: string;
  scopeItems: string[];
  retainedTitle: string;
  retainedBody: string;
  timingTitle: string;
  timingBody: string;
}>;

export const dynamic = "force-static";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};

  const copy = CONTENT[locale as Locale];

  return {
    title: copy.title,
    description: copy.description,
    alternates: {
      canonical: localePath(locale, "account-deletion"),
      languages: languageAlternates("account-deletion"),
    },
    openGraph: {
      type: "website",
      locale: ({ ko: "ko_KR", en: "en_US", ja: "ja_JP" } as const)[
        locale as Locale
      ],
      url: localeUrl(locale, "account-deletion"),
      siteName: SITE_NAME,
      title: copy.title,
      description: copy.description,
    },
    robots: { index: true, follow: true },
  };
}

export default async function AccountDeletionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const copy = CONTENT[locale as Locale] ?? CONTENT.ko;
  const mailSearch = new URLSearchParams({
    subject: copy.emailSubject,
    body: copy.emailBody,
  });
  const mailHref = `mailto:${PRIVACY_EMAIL}?${mailSearch.toString()}`;

  return (
    <>
      <SiteHeader />
      <main>
        <section className="mx-auto max-w-6xl px-5 pb-14 pt-16 md:px-8 lg:pb-20 lg:pt-24">
          <div className="max-w-3xl">
            <span className="eyebrow">{copy.eyebrow}</span>
            <h1 className="mt-6 text-[40px] font-bold leading-[1.08] text-text sm:text-[56px] lg:text-[64px]">
              {copy.headline}
            </h1>
            <p className="mt-7 max-w-170 text-[17px] leading-[1.7] text-text-muted">
              {copy.intro}
            </p>
          </div>
        </section>

        <section className="relative">
          <div className="hairline" />
          <div className="mx-auto grid max-w-6xl gap-4 px-5 py-14 md:grid-cols-2 md:px-8 lg:py-20">
            <InfoPanel
              icon={<Smartphone className="h-5 w-5" />}
              title={copy.appTitle}
              body={copy.appBody}
            />
            <InfoPanel
              icon={<Mail className="h-5 w-5" />}
              title={copy.requestTitle}
              body={copy.requestBody}
            >
              <a href={mailHref} className="btn btn-primary mt-6">
                {copy.mailCta}
              </a>
              <p className="mt-4 text-[13px] text-text-faint">
                {PRIVACY_EMAIL}
              </p>
            </InfoPanel>
          </div>
        </section>

        <section className="relative">
          <div className="hairline" />
          <div className="mx-auto max-w-6xl px-5 py-14 md:px-8 lg:py-20">
            <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
              <div>
                <span className="inline-flex rounded-full border border-line bg-raised px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-text-faint">
                  Data scope
                </span>
                <h2 className="mt-5 text-[28px] font-bold leading-[1.2] text-text sm:text-[36px]">
                  {copy.scopeTitle}
                </h2>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2">
                {copy.scopeItems.map((item) => (
                  <li key={item} className="card p-5 text-[14.5px] leading-[1.65] text-text-muted">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="relative">
          <div className="hairline" />
          <div className="mx-auto grid max-w-6xl gap-4 px-5 py-14 md:grid-cols-2 md:px-8 lg:py-20">
            <InfoPanel
              icon={<ShieldCheck className="h-5 w-5" />}
              title={copy.retainedTitle}
              body={copy.retainedBody}
            />
            <InfoPanel
              icon={<Mail className="h-5 w-5" />}
              title={copy.timingTitle}
              body={copy.timingBody}
            />
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

function InfoPanel({
  icon,
  title,
  body,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="card p-7 lg:p-8">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-raised text-accent">
        {icon}
      </div>
      <h2 className="mt-5 text-[22px] font-semibold leading-[1.3] text-text">
        {title}
      </h2>
      <p className="mt-3 text-[14.5px] leading-[1.75] text-text-muted">
        {body}
      </p>
      {children}
    </div>
  );
}
