# AlarmTalk

> [English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md)

**AlarmTalk** は OS ネイティブの音声アラームアプリです。指定された時刻に、ユーザーが選んだ声 — 録音した音声、アップロードしたクリップ、家族や恋人と共有した音声、または AI でクローンされた音声 — で実際のアラームを鳴らします。

## なぜ「本物の」アラームなのか

多くの音声アラームアプリはプッシュ通知やサーバー cron に依存しており、機内モード・Doze・弱いネットワーク環境で音もなく失敗することがあります。AlarmTalk は OS ネイティブのアラームスケジューラーで起動し、ローカルにキャッシュした音声のみを再生するため、鳴動経路にネットワークは不要です。

## 現状

- **バージョン**: `v0.1.0` (Closed Beta 準備中)
- **ブランチ**: `develop`
- **Android**: Phase 1–6 実装完了、実機検証済み
- **iOS**: AlarmKit (iOS 26+) PoC 進行中
- **Backend**: Cloudflare Workers + Hono + Turso にデプロイ済み

## 技術スタック

| レイヤー | スタック |
|---|---|
| Android | Kotlin 2.0 · Jetpack Compose · Material 3 · Room · DataStore · Retrofit · WorkManager · `AlarmManager.setAlarmClock` |
| iOS (PoC) | Swift · SwiftUI · AlarmKit · ActivityKit (Live Activity) |
| Backend | TypeScript 6 · Hono 4 · Cloudflare Workers · Zod · Vitest |
| Database | Turso (libSQL / SQLite) |
| Storage | Cloudflare R2 (決定論的 TTS キャッシュ) |
| Voice AI | ElevenLabs Instant Voice Clone + TTS |
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
./gradlew :app:assembleDebug
./gradlew :app:testDebugUnitTest
./gradlew :app:installDebug
```

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
2. 音声 AI 呼び出し(クローン・TTS)はユーザーの明示的なアクションでのみ発生し、バックグラウンドタスクや自動テストでは呼び出しません。
3. 音声データは家族・パートナーのグループ内でのみ共有されます。外部ダウンロードは設計上ブロックされます。

## ドキュメント

完全なドキュメントインデックスは [`docs/README.md`](docs/README.md) を参照。

## セキュリティ

脆弱性の報告・サポート対象バージョンは [`SECURITY.md`](SECURITY.md) を参照。

## ライセンス

MIT — [`LICENSE`](LICENSE) を参照。
