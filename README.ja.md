# AlarmTalk

> [English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md)

**AlarmTalk** は OS ネイティブの音声アラームアプリです。指定された時刻に、ユーザーが選んだ声 — 録音した音声、家族や恋人と共有した音声、または AI でクローンされた音声 — で実際のアラームを鳴らします。

## なぜ「本物の」アラームなのか

多くの音声アラームアプリはプッシュ通知やサーバー cron に依存しており、機内モード・Doze・弱いネットワーク環境で音もなく失敗することがあります。AlarmTalk は OS ネイティブのアラームスケジューラーで起動し、ローカルにキャッシュした音声のみを再生するため、鳴動経路にネットワークは不要です。

## 現状

- **バージョン**: `v0.1.2` (Closed Beta 準備中)
- **Android** — 主力プラットフォーム。コアアラームエンジンは実機検証済み:
  - 無料: システムボイス + 事前レンダリングされたアラームプリセットクリップ、解除ごとにローカルでローテーション(バケットローテーション)
  - 有料: AI クローンボイスのプリセットを「キープ」確定後にサーバー側で事前レンダリング、鳴動時は完全オフライン再生 — オフライン(機内モード)鳴動は実機 QA 待ち
  - 家族アラームは FCM データプッシュでメンバーに即時配信(鳴動自体はローカル — ルール #1) — バックグラウンド配信は実機 QA 待ち
  - Google Play Billing: コード完成、Play Console 設定待ち
- **iOS**: 保留中 — 未運営、CI ビルド無効(手動 `workflow_dispatch` のみ)
- **Backend**: Cloudflare Workers + Hono + Turso — CI で自動デプロイ + DB マイグレーション(`develop` → dev、`main` → prod)

## 技術スタック

| レイヤー | スタック |
|---|---|
| Android | Kotlin 2.0 · Jetpack Compose · Material 3 · Room · DataStore · Retrofit · WorkManager · `AlarmManager.setAlarmClock` |
| iOS (保留) | Swift · SwiftUI · AlarmKit · ActivityKit (Live Activity) |
| Backend | TypeScript 6 · Hono 4 · Cloudflare Workers · Zod · Vitest |
| Database | Turso (libSQL / SQLite) |
| Storage | Cloudflare R2 (決定論的 TTS キャッシュ) |
| Voice AI | ElevenLabs — Instant Voice Clone + TTS |
| Auth | JWT (HS256, 7日) · Google ID トークン · Apple ID トークン |
| Landing | Next.js (App Router) + next-intl + Tailwind v4 (`apps/landing`) |

## リポジトリ構成

```
.
├── apps/
│   ├── android-native/   Kotlin + Jetpack Compose Android アプリ
│   ├── ios-native/       SwiftUI + AlarmKit PoC
│   └── landing/          静的ランディングページ
├── packages/
│   ├── backend/          Cloudflare Workers + Hono API
│   ├── shared/           共通の型と Zod スキーマ
│   ├── ui/               デザイントークン
│   └── voice/            音声プロバイダー抽象化
└── docs/                 プロジェクトドキュメント
```

## クイックスタート

### Backend

```bash
cd packages/backend
npm install
npm run dev        # wrangler dev --env dev
npm test           # vitest
npm run deploy     # wrangler deploy --env production
```

シークレットはローカルの `packages/backend/.dev.vars.dev` と `packages/backend/.dev.vars.prod` にのみ置きます(コミット禁止)。詳細は [`docs/tech/`](docs/tech/README.md) を参照。

### Android

```bash
cd apps/android-native
./gradlew :app:assembleDevDebug
./gradlew :app:testDevDebugUnitTest
./gradlew :app:installDevDebug
```

`dev` / `prod` の product flavor があります。日常開発では dev バックエンドを向く `dev` フレーバー(パッケージ `com.alarmtalk.app.dev`)を使います。

Android SDK が自動検出されない場合は `apps/android-native/local.properties` を作成し `sdk.dir=...` を追加します(gitignore 済み)。

### iOS (macOS のみ)

```bash
cd apps/ios-native
brew install xcodegen
xcodegen generate
open AlarmTalkNative.xcodeproj
```

## 譲れないルール

1. アラーム鳴動経路は **OS ネイティブスケジューリング + ローカル音声** のみを使用します。プッシュ・サーバー cron・鳴動時点でのネットワーク fetch は禁止。
2. 音声クローンと単発 TTS は、ユーザーの明示的なアクションからのみ開始されます。ユーザーがプライベートなドラフトを試聴して明示的に確定(keep)した場合に限り、その 1 回のアクションが、文書化されたプリセットマニフェストをレンダリングする固定・有限・永続的なバックグラウンドジョブ 1 件を承認できます。自律的なスキャンや上限のない AI 処理は許可されず、自動テストでは有料プロバイダーを常にスタブ化します。
3. 音声データは家族・パートナーのグループ内でのみ共有されます。外部ダウンロードは設計上ブロックされます。

## ドキュメント

完全なドキュメントインデックスは [`docs/README.md`](docs/README.md) を参照。

## セキュリティ

脆弱性の報告・サポート対象バージョンは [`SECURITY.md`](SECURITY.md) を参照。

## ライセンス

MIT — [`LICENSE`](LICENSE) を参照。
