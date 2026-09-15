# Supabase接続（ローカル開発）

## 1. 接続情報をローカルへ設定する

`web/.env.example`を参考に、`web/.env.local`を新規作成する。`web/.env.local`はGit管理されない。

```dotenv
PUBLIC_SUPABASE_URL=https://<Project Reference>.supabase.co
PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_<公開キー>
```

Project URLとPublishable keyはSupabase Dashboardの**Connect**から取得する。データベースパスワード、Secret key、`service_role` keyは入力しない。

設定後はVite開発サーバーを再起動する。

```bash
cd web
pnpm dev
```

Supabase設定を残したままローカル体験版だけを確認したい場合は、開発時に限り次のように起動できる。本番ビルドではこの切替は無効になる。

```bash
PUBLIC_LOCAL_DEMO=true pnpm dev
```

## 2. Supabase CLIを準備してプロジェクトへ接続する

CLIは`web`の開発依存としてバージョン固定しているため、グローバルインストールは不要。リポジトリを取得した端末では次を実行する。

```bash
cd web
pnpm install --frozen-lockfile
pnpm supabase login
pnpm supabase link --project-ref elwqqnxjluznaooesjtr
```

ブラウザに表示されたverification codeは、`Enter your verification code:`と表示されているターミナルへ自分で入力する。コードや作成されたアクセストークンはチャットやファイルへ記録しない。

## 3. DBマイグレーションを適用して検証する

SQL Editorへの貼り付けではなく、リポジトリ内のmigrationを唯一の正本として順番に適用する。

```bash
cd web
pnpm db:status
pnpm db:push:dry
pnpm supabase db push
pnpm db:test:rls
pnpm db:security
```

- `db:status`: ローカルと接続先に適用済みのmigrationを比較する。
- `db:push:dry`: 実際に変更せず、次に適用されるmigrationを確認する。
- `supabase db push`: 未適用migrationだけを接続先へ適用する。
- `db:test:rls`: 2人の使い捨てユーザーで本人アクセス、他人の拒否、匿名拒否、進級・段階復帰・冪等性を検査し、最後に全テストデータをロールバックする。
- `db:security`: Supabaseのセキュリティ診断を実行する。

`is_admin`と`issue_problem`、`select_learning_stage`、`submit_mock`は、認証ユーザーのID検査やRLS内判定のため意図的に`security definer`としている。匿名ロールには実行権限を与えず、トリガー専用関数も直接実行できないようにする。

## 4. Authの設定を確認する

Supabase Dashboardで以下を設定する。

- Auth → Providers → Email: 有効
- Auth → URL Configuration → Site URL: `http://localhost:5173`
- Auth → URL Configuration → Redirect URLs: `http://localhost:5173/**`

開発中はSupabaseの標準メールでよい。本番公開前に独自SMTP（Resend）を設定する。

## 5. 動作を確認する

1. `http://localhost:5173/account`を開く
2. 新規登録し、確認メールのリンクを開く
3. ログイン後、課題を1つ開いて下書きを入力する
4. ページを再読み込みして下書きが残ることを確認する
5. 要修正の問題で答案を修正・再提出でき、同じ送信操作を繰り返しても合格数が二重計上されないことを確認する
6. 通常訓練で規定数に合格すると進級テストへ移り、テスト全問合格で次段階へ進むことを確認する
7. 進捗画面から段階1へ戻り、問題履歴と技能別習熟度を維持したまま以前とは異なる傾向の問題が表示されることを確認する
8. 進捗画面で通常トレーニングと進級テストの必要合格数を変更し、再読み込み後も保持されることを確認する
9. 別のブラウザプロファイルまたはシークレットウィンドウで別アカウントを作り、最初のアカウントの問題履歴・提出履歴が表示されないことを確認する
10. `web`で`pnpm db:test:rls`を実行し、例外なくROLLBACKまで完了することを確認する

この段階の添削は決定的なローカルモックであり、Claude APIには送信されない。

## 安全上のルール

- `web/.env.local`をGitへ追加しない。
- Publishable keyはブラウザに置く前提の公開用キー。アクセス制御はRLSが担う。
- Secret key、`service_role` key、DBパスワードをブラウザやこのリポジトリへ入れない。
- RLSを無効にして動作確認をしない。動かない場合はポリシーを修正する。
- `submit_mock`は内部の進級トランザクションとして残すが、ブラウザからの実行権限は削除済みである。オンライン提出は認証済みの`feedback` Edge Functionを通し、検証済みClaude添削だけを正式保存する。
- 問題生成は認証済みの`problem-generation` Edge Functionを通す。固定問題と承認済み問題バンクを優先し、新規生成が必要な場合だけClaudeを呼ぶ。反映時は`web`ディレクトリで`pnpm supabase functions deploy problem-generation --no-verify-jwt`を実行する。`--no-verify-jwt`でも無認証にはならず、関数内でSupabase Authのアクセストークンを検証する。
