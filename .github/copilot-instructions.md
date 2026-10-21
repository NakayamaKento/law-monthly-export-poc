# Copilot 向けリポジトリ指示

## 最初に読むもの
- [docs/CONTEXT.md](../docs/CONTEXT.md): 目的、お客様の制約、決定事項、検証結果、未解決事項
- [docs/plan.md](../docs/plan.md): 設計と検証手順の詳細（§12 ASE、§13 WS プランの実機結果）

## 守ること
- ユーザーとのやり取りは日本語。コードコメントは必要最小限。
- お客様環境の制約を破らない: ローカルコマンド不可（最終手順は portal だけで完結）、パブリックアクセス無効、キー認証不可、実行用 VM 不可。
- Automation Account は不採用（Hybrid Worker が必要なため）。Functions は優先度が低い。
- 検証で失敗しても、キー認証やパブリックアクセスを有効にして回避しない。計画を見直し、その検証環境だけを削除してやり直す。
- Azure 検証用のリソースは専用 RG に作り、終わったら RG と RG 外のもの（サブスクリプションの診断設定など）を削除して、残りがないことを確認する。ASE・NAT・Bastion は固定費が高い。
- 既存 RG / プランを再利用する検証では、事前にプランの GET 結果（ID・SKU・リージョン・設定・タグ）を保全し、今回作成物だけを削除する。最後のアプリの DELETE は[既定で空の App Service プランも削除する](https://learn.microsoft.com/en-us/rest/api/appservice/web-apps/delete?view=rest-appservice-2024-04-01)ため、保持する場合は `deleteEmptyServerFarm=false` を明示し、サイトを汎用 `az resource delete` で削除しない。portal でも関連プランの保持を明示できなければ削除を中止し、削除後はプラン本体を直接 GET して比較する。
- サブスクリプション ID、テナント ID、ワークスペース ID、ユーザー名などはコミットしない（`<...>` のプレースホルダーにする）。
- 公式の仕様は Microsoft Learn で確認してから設計・変更する。

## 構成
- `infra/`: Bicep（foundation / ase / app / app-ws）
- `logicapp/`: ワークフロー定義と host.json、connections.json
- `settings/`: アプリ設定のサンプル
- `scripts/`: 検証用スクリプト（PoC 時のリソース名が残っている）
- `docs/`: 計画・コンテキスト

## 作業の進め方
- 変更したら、関連するドキュメント（README、docs）も更新する。
- 検証結果は docs/plan.md に追記する（日付、構成、結果、差異・学び）。
