# law-monthly-export-poc

Log Analytics のログを月次で CSV にエクスポートし、非公開の Blob Storage に保管する自動化の PoC です。
過去 PoC は Logic Apps Standard（HTTP アクション + マネージド ID）で Log Analytics Query API を呼び、キー認証・パブリックアクセスなしで動作することを Southeast Asia で検証しました。現在のワークフロー正本はコネクタ中心へ見直した評価版で、過去版の動作証拠を流用しません。

## 顧客向けサンプル

配布対象は **[customer/](customer/)** です。[顧客向け README](customer/README.md) から、portal のみの導入・実行・CSV 取得・受入確認・削除の順に読めます。ARM JSON・設定例・ワークフローを同梱しています。

**構成を再検討中（2026-10-21）**：お客様の Storage 要件はネットワーク設定で Public を拒否することで、Private Endpoint 必須とは限らないことを確認しました。信頼されたサービスの例外とシステム MI を利用する **Consumption 案を次の検証候補**とします。[設計案・必要資源・検証ゲート](docs/plan.md#21-consumption-案の再検討2026-10-21)を参照してください。Consumption 版は未実装・未検証で、以下の配布物は WS1 版のままです。

- 現行配布物は **WS1**。ただしホスト Storage のキー無効化は[公式資料の記載](https://learn.microsoft.com/en-us/azure/logic-apps/create-single-tenant-workflows-azure-portal#set-up-managed-identity-access-to-your-storage-account)と異なり、**サポート範囲確認が導入前の必須条件**です。
- 過去 PoC の動作実績と、今回の配布資材・portal 手順の検証状態を分けています。portal 実機受入は未実施です。
- Azure リソースの作成はサポート確認と構成・費用・権限の個別承認後に行います。
- 生成元と提供者向けの再生成・静的検証は [保守手順](docs/customer-maintenance.md) を参照してください。
- 顧客用 WS1 構成は、**Storage 1 個・PE 4 個・DNS 4 ゾーン**。ホストと exports コンテナーを統合し、Queue / Table はホスト依存として保持します。Files / AMPLS / Monitor DNS / 未使用サブネットは除外しています。
- Blob は組み込み、LAW は Azure Monitor Logs 管理コネクタを MI で使い、REST API の直書きをなくしました。[構成図](customer/README.md)と[接続・導入手順](customer/docs/setup.md)を参照してください。[管理版の制限](https://learn.microsoft.com/en-us/azure/connectors/connectors-azure-monitor-logs)は応答約 16 MiB・クエリ最大 100 秒へ変わります。
- 見直し版は 3 段階 ARM の実投入とダミー実行に成功。**保存済み Blob を独立して読み戻し、1 月 4 件・0 件月・2 月 1 件、BOM・日本語・引用符・改行・manifest / current を照合**しました。Query の時間範囲「クエリで設定」は実コネクタのメタデータで `"3"` と確認して配布済みです。提供者の管理 API 検証であり、portal 完結の受入や公式サポート確認を代替しません。

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
| `settings/` | アプリ設定（LAW_RESOURCE_ID、OUT_BLOB_URI、MONITOR_*、KQL_BODY、MONTH_OVERRIDE など）のサンプル |
| `scripts/` | 手動実行・管理 VM からの読み戻し・外部遮断確認用スクリプト |

## 提供者向けの元 PoC 操作（参考、顧客向けではない）

以下は過去の HTTP 版の操作記録です。現在の正本は API 接続と接続 JSON も必要なため、この 4 行だけでは構築できません。現行版には [顧客手順](customer/docs/setup.md)を使い、閉域 LAW の旧 ASE 構成へ現行の管理コネクタを無条件に流用しません。

1. `az group create`、`az deployment group create -f infra/foundation.bicep` で基盤を作成
2. WS 構成: `snet-integ`（10.50.4.0/24、Microsoft.Web/serverFarms 委任）を作り `infra/app-ws.bicep` をデプロイ
3. Logic App のシステム割り当て MI に、出力 Storage の Storage Blob Data Contributor と Log Analytics Reader を付与
4. `settings/` を参考にアプリ設定を投入し、`logicapp/` のファイルを配置

## 注意

- 検証用スクリプトには PoC 時のリソース名・Storage 名が残っています。環境に合わせて書き換えてください。サブスクリプション ID・ワークスペース ID などは `<...>` のプレースホルダーに置換済みです。
- WS プランでホスト Storage のキーを無効にする構成は公式資料の記載と異なり、サポート可否が未確認です。本番前に確認してください。
- 未検証: 実際の月次発火、50 万行超の分割、PartialError の実発生、Bastion 経由のブラウザー操作。
- ASE は固定費が高額です。

## 公開情報の参照先

- [Standard の Storage 利用（Blob / Queue / Table）](https://learn.microsoft.com/en-us/azure/logic-apps/estimate-storage-costs)
- [Standard の Private Endpoint と VNet 統合](https://learn.microsoft.com/en-us/azure/logic-apps/secure-single-tenant-workflow-virtual-network-private-endpoint)
- [Azure Blob Storage 組み込みコネクタ](https://learn.microsoft.com/en-us/azure/logic-apps/connectors/built-in/reference/azureblob/)
- [マネージド ID によるコネクタ認証](https://learn.microsoft.com/en-us/azure/logic-apps/authenticate-with-managed-identity)
- [Consumption の Blob 管理コネクタとシステム MI による例外接続](https://learn.microsoft.com/en-us/azure/connectors/connectors-create-api-azureblobstorage#access-blob-storage-in-same-region-with-system-managed-identities)
- [Storage の Public 無効化と信頼されたサービスの例外の優先関係](https://learn.microsoft.com/ja-jp/azure/storage/common/storage-network-security-limitations)

構成のリソース数・保存形式・実行結果は本サンプルの設計・実測です。公開資料による本構成のサポート保証とは区別してください。
