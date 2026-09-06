# Cloudflare検証環境の手順

最終更新: 2026-09-03

## 目的

一般公開の前に、Cloudflare Workers上で画面配信、Supabase認証、データ保存を本番に近い条件で確認する。現段階は検証環境であり、不特定多数へ案内しない。

現在の検証URL: `https://essay-training-staging.language-training.workers.dev`

## 準備済みの内容

- SvelteKitを`@sveltejs/adapter-cloudflare`でビルドする。
- Wranglerは`web/`内の開発依存関係として固定し、グローバルへインストールしない。
- `wrangler.jsonc`で検証用Worker名、静的アセット、互換性フラグを管理する。
- `pnpm verify`、Wranglerのdry-run、ローカルWorkers環境の`/`と`/tasks`で動作確認済み。
- Cloudflareへの初回公開が完了し、公開先の`/`、`/tasks`、`/manifest.webmanifest`、`/service-worker.js`がHTTP 200で応答することを確認済み。
- 初回訪問者向けの`/login`にログイン・新規登録の併用画面を設け、未ログイン時はアプリ本体から自動で案内する。
- SupabaseのProject URLとPublishable keyは、検証用Workerの暗号化シークレットとして登録する。値はGit管理しない。
- `.env.local`、`.dev.vars`、`.wrangler/`はGitへ含めない。

## 1. Cloudflareへログインする

```bash
cd /Users/fumi/Documents/GitHub/essay_training_system/web
pnpm exec wrangler login
```

ブラウザにCloudflareの承認画面が開いたら、使用するCloudflareアカウントで承認する。Codexへブラウザ操作権限を渡す必要はない。完了後、次でログイン状態を確認する。

```bash
pnpm cf:whoami
```

## 2. 初回だけworkers.devサブドメインを登録する

Cloudflare Dashboardの`Workers & Pages`を開く。まだ`workers.dev`サブドメインがない場合は、案内に従ってアカウント共通のサブドメインを登録する。

- これはWorkerごとの名前ではなく、このCloudflareアカウント全体で使うURLの一部である。
- 世界中で未使用の名前を選ぶ必要がある。
- アプリのWorker名は`essay-training-staging`として別に管理される。

すでにサブドメインが表示されている場合、この操作は不要である。

## 3. 検証版を公開する

```bash
pnpm cf:deploy
```

成功すると`https://...workers.dev`形式のURLが表示される。このURLを検証用URLとして控える。

## 4. Supabase AuthへURLを登録する

Supabase Dashboardで対象プロジェクトを開き、`Authentication` → `URL Configuration`へ進む。

- `Site URL`: `https://essay-training-staging.language-training.workers.dev`
- `Redirect URLs`: `https://essay-training-staging.language-training.workers.dev/**`
- ローカル確認を続けるため、`http://localhost:5173/**`は残す。

公開URLが確定するまでは、推測したURLを登録しない。

## 5. 検証する

次を別々のテストユーザーで確認する。

1. 未ログインで公開URLを開くと`/login`へ移動し、同じ画面で新規登録またはログインできる。
2. 課題の下書き、提出、再提出がSupabaseへ保存される。
3. ページを再読み込みしても進捗と履歴が戻る。
4. 別ブラウザまたは別端末でも同じ学習データが表示される。
5. 別ユーザーの履歴を閲覧・変更できない。
6. 通常トレーニング、進級テスト、再トレーニングの遷移が正しい。

## 一般公開前に必須の作業

- Claude添削用Edge Functionを接続し、モック添削を本番経路から外す。
- ブラウザから`submit_mock`を実行できる権限を削除する。
- Stripeの決済、Webhook、利用権判定を実装する。
- レート制限、Turnstile、監視、バックアップ、削除手順を整える。
- 本番ドメインを確定し、Supabaseの許可URLを完全一致中心へ絞る。
- GitHub連携ビルドと検証環境・本番環境の分離を行う。
- 検証中はCloudflare Accessで保護するか、Supabaseの新規登録を必要時だけ有効にする。

## 秘密情報の扱い

ブラウザへ置いてよいのはSupabaseのProject URLとPublishable keyだけである。Claude APIキー、Stripe秘密鍵、Supabase service-roleキーはCloudflareの公開変数やGit管理ファイルへ置かず、使用するSupabase Edge Functionのsecretとして管理する。
