# Log Analytics 月次 CSV エクスポート（Consumption）

Logic Apps **Consumption** の月次 Recurrence で前月のログを取得し、Public network access を Disabled にした Storage へ CSV を保存する評価用サンプルです。

- Monitor Logs / Blob は**管理コネクタ＋システム割り当て MI**。
- 期間計算・応答検証・CSV 変換は組み込みアクション。REST API の直書き、キー、SAS、ユーザーの接続資格情報なし。
- Storage は初回から **Disabled / Deny / AzureServices**、Shared Key・匿名アクセス無効。例外接続は Private Endpoint 通信ではありません。
- **2026-10-22 に Consumption の実構築、10/26 に固定列順版の実機確認を実施**。初回から Disabled / keyless のまま、キー順が異なる4 / 0 / 1件・再実行とダミー明細4列・集計3列の保存・実行内読み戻しに成功しました。独立した CSV 取得・実月次・本番量は未検証です。検証環境の6資源と専用RGは portal で削除完了し、RGの直接再表示でも404を確認しました。旧 WS1 の実績を流用しません。

## 顧客向け提供

配布対象は **[customer/](customer/)** 単独です。[顧客向け入口](customer/README.md) → [導入](customer/docs/setup.md) → [ダミーテスト](customer/docs/validation.md) → [運用・取得・削除](customer/docs/operations.md)の順に進めます。顧客はブラウザーと Azure portal のみで操作し、CLI / Cloud Shell / ローカルコマンドは使いません。

[KQL パターンの変更](customer/docs/query-patterns.md)では、顧客の業務に合わせて `KQL_BODY` と `COLUMNS` を差し替えます。列構成を変える場合は CSV アクションのカスタム列も更新します。明細・失敗のみ・操作別集計の設定、貼り付け用 `.kql` と `.csv-columns.json` を同梱。月次 CSV は明示したカスタム列の順で固定し、bag のキー順には依存しません。前月の暦月は自動計算するため、月の日数に合わせた変更は不要です。複数パターンの一括実行ではなく、1 ワークフローで有効なパターンの切り替えです。

構成は Consumption 1、保存用 Storage 1 と exports、API 接続 2、評価用 LAW 1、アプリ MI のロール 2。WS1 / App Service プラン、ホスト用 Storage 設定、ユーザー割り当て MI、実行用 VNet / PE / Private DNS、VM / Bastion / NAT / ASE / AMPLS は不要です。

**操作者の CSV 取得経路は別条件**です。Logic App の信頼されたサービスの例外をブラウザーが利用できるわけではありません。取得用ネットワークは本テンプレートに含めず、未確定の環境ではファイル取得の受入を止めます。

## 提供者向け

| 場所 | 内容 |
|---|---|
| [infra/customer/](infra/customer/) | Consumption 用の 3 段階 Bicep 正本 |
| [logicapp/monthly-export/](logicapp/monthly-export/) | Consumption ワークフロー定義 |
| [settings/](settings/) | ダミー / 実テーブル用のワークフローパラメーター例 |
| [scripts/](scripts/) | 再生成・静的検証。顧客の操作手順には含めない |
| [保守手順](docs/customer-maintenance.md) | 正本・生成物・変更時の検証 |
| [コンテキスト](docs/CONTEXT.md) | 現在の要件・判断・未検証点 |
| [設計・検証記録](docs/plan.md) | §22 が Consumption 切替、§23 が portal 実構築、§26 が固定列順版の実機確認。§1～§21 は過去の計画・実績 |

旧 ASE / WS1 用の実行資材は現行経路から除去しました。過去の削除事故を含む記録は保持しますが、過去版の実機成功は Consumption の動作証明ではありません。

## 公開根拠

- [Consumption の portal 作成](https://learn.microsoft.com/en-us/azure/logic-apps/quickstart-create-example-consumption-workflow)
- [Blob の Consumption＋システム MI による例外接続](https://learn.microsoft.com/en-us/azure/connectors/connectors-create-api-azureblobstorage#access-blob-storage-in-same-region-with-system-managed-identities)
- [Storage の Public 無効と例外の優先関係](https://learn.microsoft.com/ja-jp/azure/storage/common/storage-network-security-limitations)
- [信頼されたサービス一覧](https://learn.microsoft.com/ja-jp/azure/storage/common/storage-network-security-trusted-azure-services)
- [Consumption の MI 対応コネクタと V1 接続](https://learn.microsoft.com/en-us/azure/logic-apps/authenticate-with-managed-identity)
- [Monitor Logs の制限](https://learn.microsoft.com/en-us/azure/connectors/connectors-azure-monitor-logs)

公開資料の接続例は「選択したネットワークから有効」です。**今回の評価環境では初回から Disabled の接続に成功しましたが、導入先ごとに再確認し、失敗時に Public やキーを有効化しません。**
