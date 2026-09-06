# essay_training web

SvelteKit + TypeScriptで作成した学習者向けPWAです。

```bash
pnpm install --frozen-lockfile
pnpm curriculum:build
pnpm verify
pnpm dev
```

- `curriculum:build`: Excel原本からアプリ用JSONを生成
- `check`: Svelte・TypeScriptの型検査
- `test`: Vitestの単体テスト
- `build`: 本番ビルド
- `verify`: 変換、型検査、テスト、ビルドを順に実行
- `cf:whoami`: Cloudflare CLIのログイン状態を確認
- `cf:preview`: Cloudflare Workers互換環境でローカル起動
- `cf:deploy`: Cloudflare Workersへ検証版を公開

`web/.env.local`へSupabaseのProject URLとPublishable keyを設定すると、アカウント画面から登録・ログインでき、学習データはSupabaseへ保存されます。未設定時はブラウザの`localStorage`を使うローカル体験版です。詳細は[`../docs/supabase-local-setup.md`](../docs/supabase-local-setup.md)を参照してください。

学習は14段階です。通常トレーニングで初期値10問に合格すると、初期値3問の合格が必要な進級テストへ移ります。テストで不合格になった問題は再提出せず、新しい問題へ進みます。到達済みの段階には後から戻れます。

現在の問題は固定問題バンクとローカル派生処理から選び、添削もブラウザ内の決定的なモックです。実行時に外部の生成AIは呼びません。Claude添削とAI問題生成はSupabase Edge Functionsへ接続する次工程です。

Cloudflare検証環境の設定は[`../docs/cloudflare-staging.md`](../docs/cloudflare-staging.md)を参照してください。
