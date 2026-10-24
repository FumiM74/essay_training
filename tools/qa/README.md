# QA固定問題消費テスト

このフォルダは、通常利用者へ影響せず、指定STEPの固定問題と承認済み共有問題を使い切った直後のClaude問題生成を確認するためのローカル専用ツールです。

固定問題数は`web/src/lib/data/curriculum.json`から実行時に取得する。STEP 1〜3の各10セット、STEP 4以降の拡張済み問題数に自動で追随するため、問題追加時に件数を手作業で変更しない。

## 準備

1. テスト用メールアドレスで通常どおりアプリへ登録し、確認メールを完了する。
2. Supabase AuthからそのユーザーUUIDを取得する。
3. `.env.qa.example`を`.env.qa.local`へコピーし、実値を入力する。`.env.qa.local`はGit管理しない。

## 実行

```bash
node --env-file=tools/qa/.env.qa.local tools/qa/seed-exhausted-stage.mjs --stage 4 --confirm seed-stage-4
```

通常のアプリへ同じテストアカウントでログインし、指定したSTEPで次の問題を開く。スクリプトはそのSTEPの固定問題と現在の承認済み共有問題を、当該テスト利用者だけの履歴上で消費済みにする。共有問題そのものは変更しない。

次の問題ではClaude生成が呼ばれる。生成成功は、問題が表示されただけで判断せず、`problem_bank.status = qa`の問題とAI使用履歴が作成されたことでも確認する。Claudeを利用できない場合はローカル問題へ代替する設計のため、この確認が必要である。

Claude生成問題は`problem_bank.status = qa`で保存され、一般利用者には出題されない。
QA問題には通常問題と重ならない`-q`付き内部IDとQA専用本文ハッシュを使用する。

DB側の投入・隔離・リセットをロールバック付きで検査する場合は、`web`で次を実行する。

```bash
pnpm db:test:qa
```

## リセット

```bash
node --env-file=tools/qa/.env.qa.local tools/qa/reset-qa-learner.mjs --confirm-reset
```

このリセットは、登録済みQAアカウントの下書き、提出、添削、履歴、技能統計、進捗、AI利用記録、およびそのアカウントが生成した`qa`問題だけを削除する。通常利用者、`approved`問題、アプリ本体は変更しない。
最高到達段階と設定も初期値へ戻る。

## 削除

必要な`qa`問題を確認・昇格または削除し、テストアカウントをリセットした後、この`tools/qa/`フォルダを削除できる。
