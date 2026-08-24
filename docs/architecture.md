# サービス実装方針

最終更新: 2026-08-21

このファイルを、サービス実装に関する設計判断の唯一の正本とする。`handoff.md`と`../curriculum-design/小論文添削サービス_カリキュラム設計.xlsx`は、経緯と教育内容の参照資料として保持する。

## 採用構成

- PWA: SvelteKit + TypeScript（Vite内蔵）
- 認証・DB・RLS・リアルタイム・サーバー処理: Supabase Auth、PostgreSQL、RLS、Realtime、Edge Functions
- 配信・ボット対策: Cloudflare Pages + Turnstile
- 課金: Stripe。決済状態はWebhookから`entitlements`へ反映し、アプリは利用権だけを参照する。
- メール: Resend（Supabase Authの本番SMTP、決済・障害通知）
- AI添削: Claude API。実装はモデルプロバイダーを差し替え可能にする。

Cloudflare Workersは初期構成に含めない。添削キュー、負荷平準化、追加のAPIゲートウェイが必要になった時だけ導入する。

## シンプルなフォルダ構成

```text
web/                  SvelteKitの学習者向けPWA
  src/lib/domain/     段階・進捗・合格の純粋な学習ルール
  src/lib/features/   学習、認証、課金の画面機能
  src/lib/services/   Supabase接続
  src/lib/types/      UserSession、AccessState、API・添削結果の型
  static/             PWAアイコン・manifest
supabase/             DB・RLS・Edge Functions
  migrations/         PostgreSQLスキーマ、RLS、DB関数
  functions/          feedback、create-checkout、stripe-webhook、admin
scripts/              カリキュラムExcel→JSON変換
docs/                 設計・運用記録
```

SvelteKitを使うのは`web/`だけとする。`node_modules/`、`.svelte-kit/`、`build/`などの自動生成物も同じディレクトリ内に閉じ、Git管理しない。

## 境界契約

- `UserSession`: `userId`と`role`。学習ルールは認証実装に依存しない。
- `AccessState`: `canSubmit`、プラン、有効期限、残提出数。学習画面はStripeの決済詳細に依存しない。
- `FeedbackResult`: JSON Schemaで検証済みの添削結果だけを表示・保存する。

ブラウザにClaude APIキー、Stripe秘密鍵、Supabase service-roleキーを置かない。正式提出・添削・決済WebhookはEdge Functionで処理する。

## 実装順

1. `web/`のSvelteKit、共通型、開発・テスト基盤を作る。
2. DBスキーマ、RLS、権限テストを`supabase/migrations/`へ追加する。
3. カリキュラムExcelからJSONを生成・検証する。
4. AIモックで、課題、下書き自動保存、提出、結果、履歴、進捗を作る。
5. Claude添削の`feedback` Edge Functionを実装する。
6. 管理者機能を加える。
7. Turnstile、レート制限、メール、削除・バックアップ運用を加える。
8. Stripeと利用権を実装する。
9. 少人数テスト後に一般公開する。

## 公開前に確定する事項

- 無料枠、月額・年額・期限付き利用権の価格と利用上限
- メールOTPかマジックリンクかを含む最終認証導線
- 独自ドメインと運営者情報
- データ保持・削除方針、利用規約、プライバシーポリシー、未成年・保護者同意の扱い

## 実装前のデータ確認

カリキュラムExcelの段階13には同じ評価項目の重複行がある。ExcelをJSONの正本にする前に、この重複を整理する。
