# law-monthly-export-poc

Log Analytics のログを月次で CSV にエクスポートし、非公開の Blob Storage に保管する自動化の PoC です。
Logic Apps Standard（HTTP アクション + マネージド ID）で Log Analytics Query API を呼び、キー認証・パブリックアクセスなしで動作することを Southeast Asia で検証しました。

## 顧客向けサンプル

配布対象は **[customer/](customer/)** です。[顧客向け README](customer/README.md) から、portal のみの導入・実行・CSV 取得・受入確認・削除の順に読めます。ARM JSON・設定例・ワークフローを同梱しています。

- 主構成は **WS1**。ただしホスト Storage のキー無効化は公式資料の記載と異なり、**サポート範囲確認が導入前の必須条件**です。
- 過去 PoC の動作実績と、今回の配布資材・portal 手順の検証状態を分けています。portal 実機受入は未実施です。
- Azure リソースの作成はサポート確認と構成・費用・権限の個別承認後に行います。
- 生成元と提供者向けの再生成・静的検証は [保守手順](docs/customer-maintenance.md) を参照してください。

以下は提供者向けの元 PoC 構成・参考情報です。顧客に CLI 実行を求める手順ではありません。

結果の詳細・設計・検証手順は [docs/plan.md](docs/plan.md)（§12 ASE v3、§13 Workflow Service Plan）を参照してください。
これまでの経緯・お客様の制約・決定事項・未解決事項・次の作業は [docs/CONTEXT.md](docs/CONTEXT.md) にまとめています。Copilot 向けの指示は [.github/copilot-instructions.md](.github/copilot-instructions.md) です。

## 構成

| パス | 内容 |
|---|---|
| `infra/foundation.bicep` | VNet、プライベート DNS、ユーザー割り当て MI、ホスト/出力 Storage、Log Analytics、AMPLS、プライベートエンドポイント |
| `infra/ase.bicep`, `infra/app.bicep` | 内部 ASE v3 + Isolated v2 プラン + キーなし Logic App（ASE 構成） |
| `infra/app-ws.bicep` | WS1 + VNet 統合 + 公開なし + キーなし Logic App（WS 構成。`snet-integ` サブネットは別途作成が必要） |
| `logicapp/` | ワークフロー定義（`monthly-export`）、`host.json`、`connections.json`、1 分周期の発火確認用ワークフロー |
| `settings/` | アプリ設定（LAW_ID、OUT_BLOB_URI、KQL_BODY、MONTH_OVERRIDE など）のサンプル |
| `scripts/` | 手動実行・管理 VM からの読み戻し・外部遮断確認用スクリプト |

## 提供者向けの元 PoC 操作（参考、顧客向けではない）

1. `az group create`、`az deployment group create -f infra/foundation.bicep` で基盤を作成
2. WS 構成: `snet-integ`（10.50.4.0/24、Microsoft.Web/serverFarms 委任）を作り `infra/app-ws.bicep` をデプロイ
3. Logic App のシステム割り当て MI に、出力 Storage の Storage Blob Data Contributor と Log Analytics Reader を付与
4. `settings/` を参考にアプリ設定を投入し、`logicapp/` のファイルを配置

## 注意

- 検証用スクリプトには PoC 時のリソース名・Storage 名が残っています。環境に合わせて書き換えてください。サブスクリプション ID・ワークスペース ID などは `<...>` のプレースホルダーに置換済みです。
- WS プランでホスト Storage のキーを無効にする構成は公式資料の記載と異なり、サポート可否が未確認です。本番前に確認してください。
- 未検証: 実際の月次発火、50 万行超の分割、PartialError の実発生、Bastion 経由のブラウザー操作。
- ASE は固定費が高額です。
