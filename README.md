# essay_training

小論文添削サービスの学習者向けPWAです。

## 構成

- `web/`: SvelteKit + TypeScriptの学習者向けPWA
- `supabase/`: PostgreSQLスキーマ、RLS、Edge Functions
- `scripts/`: カリキュラムExcelをアプリ用JSONへ変換する処理
- `docs/`: 設計正本と引き継ぎ資料

## 開発開始

```bash
cd web
pnpm install
pnpm run check
pnpm run dev
```

Supabaseプロジェクトを作成後、`supabase/migrations/`のSQLを適用する。
