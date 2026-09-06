# essay_training

小論文添削サービスの学習者向けPWAです。

## 構成

- `web/`: SvelteKit + TypeScriptの学習者向けPWA
- `supabase/`: PostgreSQLスキーマ、RLS、Edge Functions
- `web/scripts/`: カリキュラムExcelをアプリ用JSONへ変換する処理
- `docs/`: 設計正本と引き継ぎ資料
- `開発進捗管理.xlsx`: カテゴリ別の進捗、次の作業、更新履歴の正本

## 進捗管理

実装作業の終了時は、`開発進捗管理.xlsx`の該当タスクと更新履歴を更新する。
設計判断は`docs/architecture.md`、実装状況は`開発進捗管理.xlsx`へ記録する。

## 開発開始

```bash
cd web
pnpm install
pnpm curriculum:build
pnpm verify
pnpm run dev
```

ブラウザで`http://localhost:5173/`を開く。現在は14段階で、通常トレーニング、進級テスト、再トレーニングを繰り返す。通常トレーニングは初期値10問、進級テストは初期値3問の合格で進み、必要合格数は学習者が変更できる。到達済み段階への再移動、下書き自動保存、提出履歴、学習進捗も確認できる。

ローカルMVPの学習データはブラウザの`localStorage`だけに保存する。自動保存は活動数に含めず、モック添削への提出を1活動として数える。

`pnpm curriculum:build`は、`curriculum-design/小論文添削サービス_カリキュラム設計.xlsx`から`web/src/lib/data/curriculum.json`を生成する。完全一致の重複行だけを除外し、同じ識別子に異なる内容がある場合は変換を停止する。

## Supabase接続

Supabaseを設定すると、メール＋パスワードでアカウントを作成し、下書き・提出履歴・進捗・活動グリッドを端末をまたいで保存できる。接続前は従来どおりローカル体験版として動作する。

接続情報の安全な設定、DBマイグレーション、RLS確認は[Supabaseローカル設定手順](docs/supabase-local-setup.md)を参照する。

## Cloudflare検証環境

本番公開前の検証にはCloudflare Workersを使う。設定と公開手順は[Cloudflare検証環境の手順](docs/cloudflare-staging.md)を参照する。
