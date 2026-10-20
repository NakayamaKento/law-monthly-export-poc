# Log Analytics 月次 CSV エクスポート：顧客評価用サンプル

Log Analytics の前月分を日本時間の暦月で問い合わせ、非公開 Blob Storage に UTF-8 BOM 付き CSV として保存するサンプルです。Logic Apps Standard（WS1）の組み込み HTTP アクションとマネージド ID を使います。

## 最初にお読みください

> **導入前の停止条件：WS1 のサポート確認が必要です。**
>
> Microsoft Learn は、通常の Workflow Service Plan ではホスト Storage のキーアクセスを無効化できないと記載しています。本サンプルはコンテンツ共有を設定しない ARM 構成で起動・実行・再起動に成功した PoC を基にしていますが、**公式サポート範囲は未確認**です。お客様の要件を満たすサポート構成と確認できるまで、デプロイしないでください。キー認証や公開アクセスを一時的に許可して進める手順はありません。

本資料は**評価用**であり、本番導入の保証ではありません。今回追加した ARM 資材と portal 手順は静的確認の対象で、同一資材による Azure portal 実機受入は未実施です。過去の CLI / 管理 API による動作実績を、portal 手順の実証と読み替えないでください。

## 読む順序

1. [導入手順](docs/setup.md)：サポート・費用・権限の承認、閉域管理経路、基盤、設定、ワークフローの配置。
2. [受入確認](docs/validation.md)：固定サンプルの期待値、正常・異常・閉域・再起動の確認、本番化前の条件。
3. [運用・後片付け](docs/operations.md)：対象月の変更、手動実行、CSV 取得、障害対応、削除。

読者は Azure の基本操作と IAM / VNet の知識がある管理者を想定しています。顧客側はブラウザーのみを使い、ローカルコマンド、Cloud Shell、Run Command、VS Code、CLI は不要です。

## 同梱物

| 資材 | 用途 |
|---|---|
| [01-foundation.json](infra/01-foundation.json) / [入力例](infra/01-foundation.parameters.json) | VNet、Storage、ホスト用 ID、LAW、AMPLS、DNS、PE、ホスト用 RBAC |
| [02-app-ws.json](infra/02-app-ws.json) / [入力例](infra/02-app-ws.parameters.json) | WS1、Logic App、送信用 VNet 統合サブネット |
| [03-access.json](infra/03-access.json) / [入力例](infra/03-access.parameters.json) | アプリ MI のデータ権限、アプリ受信用 PE / DNS |
| [sample.json](settings/sample.json) | 初回評価用の全 5 設定。実環境の値に置換して使う |
| [azureactivity.json](settings/azureactivity.json) | 任意の実ログ試験用の KQL / 列設定の差分 |
| [workflow.json](logicapp/monthly-export/workflow.json) | Stateful ワークフローのファイル全体 |
| [definition.json](logicapp/monthly-export/definition.json) | コードビューが定義本体だけを表示する場合の貼り付け用 |
| [host.json](logicapp/host.json) / [connections.json](logicapp/connections.json) | 元プロジェクトのランタイム設定参照用。portal への配置手順は導入手順を参照 |

このフォルダーをまとめて渡せます。同梱 ARM JSON に外部テンプレートの取得やコンパイルは不要です。`<...>` は入力時に置換するプレースホルダーで、そのまま投入する値ではありません。内部 PoC のスクリプト・個人パス・実環境 ID は配布しません。

## 構成と制約

```text
閉域管理端末のブラウザー → Azure portal
  ├─ Logic App 用 PE → WS1 上の Stateful ワークフロー
  └─ 出力 Blob 用 PE → Entra ID で CSV 取得

WS1 → VNet 統合 → AMPLS 用 PE → Log Analytics Query API
                → Storage 用 PE → ホスト Storage / 出力 Blob
認証・管理の送信：Entra ID / Azure 管理系への承認済み経路
```

- データ面の公開アクセスと Storage の Shared Key を最初から無効にします。ホスト ID はユーザー割り当て、クエリ / 出力 ID はアプリのシステム割り当てです。
- ARM 管理 API 経由のログクエリや Log Analytics マネージドコネクタではなく、`api.loganalytics.azure.com` を組み込み HTTP で呼びます。
- 日時は毎月 5 日 09:00 JST を意図した設定です。実月次の自動発火と初回発火は未検証です。
- 現在は **1 回の問い合わせで 1 CSV**。500,000 行以上は失敗扱いで、自動分割はありません。行数未満でもサイズ・時間・実行基盤の制限を超えます。本番量を処理できるとは保証しません。
- 同月の実行ごとに run を作り、成功後に `current.json` を更新します。旧 run の自動削除、失敗通知、同時実行の強制排他、応答スキーマの厳密検証は未実装です。
- 管理経路は別途必要です。管理 VM / Bastion / NAT はテンプレートに含めません。実行専用 VM は不要です。
- ASE v3 はキー無効化に関する公式記載がある別候補ですが、本一式には含めません。WS1 の確認が取れなければ停止し、別設計と費用を承認してください。

## 公式資料

- [Standard のホスト Storage を MI 認証にする](https://learn.microsoft.com/en-us/azure/logic-apps/create-single-tenant-workflows-azure-portal#set-up-managed-identity-access-to-your-storage-account)
- [非公開 Storage を使う Standard のデプロイ](https://learn.microsoft.com/en-us/azure/logic-apps/deploy-single-tenant-logic-apps-private-storage-account)
- [Standard の Private Endpoint と VNet 統合](https://learn.microsoft.com/en-us/azure/logic-apps/secure-single-tenant-workflow-virtual-network-private-endpoint)
- [Azure Monitor Private Link の設計](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/private-link-design)

導入時にも最新仕様・対象契約の提供状況・組織ポリシーを確認してください。
