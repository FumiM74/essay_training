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

`web/.env.local`へSupabaseのProject URLとPublishable keyを設定すると、アカウント画面から登録・ログインでき、学習データはSupabaseへ保存されます。未設定時はブラウザの`localStorage`を使うローカル体験版です。詳細は[`../docs/supabase-local-setup.md`](../docs/supabase-local-setup.md)を参照してください。

学習は13段階です。各段階の問題数は固定せず、合格条件を満たすまで1問ずつ出題します。段階別の特徴署名、技能別習熟度、全段階の題材経験から次の訓練目標を選び、承認済み問題を優先します。適切な在庫がない場合だけAI生成を使う設計で、生成失敗・予算超過時はローカル問題へ戻します。初期値3回の連続合格で次段階へ進み、必要回数は進捗画面で1〜10回に変更できます。到達済みの段階には後から戻れます。
