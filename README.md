# Log Analytics 月次 CSV エクスポート（Consumption）

Logic Apps **Consumption** の月次 Recurrence で前月のログを取得し、Public network access を Disabled にした Storage へ CSV を保存する評価用サンプルです。

- Monitor Logs / Blob は**管理コネクタ＋システム割り当て MI**。
- 期間計算・応答検証・CSV 変換は組み込みアクション。REST API の直書き、キー、SAS、ユーザーの接続資格情報なし。
- Storage は初回から **Disabled / Deny / AzureServices**、Shared Key・匿名アクセス無効。例外接続は Private Endpoint 通信ではありません。
- CSVの列順はカスタム列で固定。1つのStorage Account・exportsを共用し、KQLごとのワークフロー名でCSV・manifest・currentを分離します。

## 顧客向け提供

配布対象は **[customer/](customer/)** 単独です。[顧客向け入口](customer/README.md) → [導入](customer/docs/setup.md) → [ダミーテスト](customer/docs/validation.md) → [運用・取得・削除](customer/docs/operations.md)の順に進めます。顧客はブラウザーと Azure portal のみで操作し、CLI / Cloud Shell / ローカルコマンドは使いません。

[KQLの設定・追加](customer/docs/query-patterns.md)では、業務KQLと固定列、Perf日次CPU平均などの例、追加時のARM入力とportal操作を説明しています。貼り付け用 `.kql` と `.csv-columns.json` を同梱し、実データなしでもダミー試験ができます。通常運用はJST前月を自動計算します。

取得元は既存LAWを使い、新規作成・保持／取り込み／ネットワーク設定の変更・削除を行いません。共通の新規保存基盤はStorage 1とexportsです。KQLごとにConsumption 1、API接続2、アプリMIのロール2を追加します。第1段階は1回だけ、第2・3段階をKQLごとに実施し、両段階の`lawResourceId`へ既存LAWのARM IDを指定します。LAWが別RG・別サブスクリプションの場合も、第3段階の内包子テンプレートが既存LAWスコープのReaderだけを付与します。LAW側のRGへのデプロイ権限と接続は導入先で受入確認します。

保存先は `exports/<workflowName>/<YYYY-MM>/...`、CSV名は `<workflowName>_<対象月>_<実行日時yyyyMMdd-HHmmss>-JST.csv`。実行フォルダーには衝突防止用の完全な実行IDを保持します。[追加KQLの入力対応表と例](customer/docs/query-patterns.md#5-複数kqlを1つのstorage-accountへ保存する)を参照してください。

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
| [設計・検証記録](docs/plan.md) | §22 が Consumption 切替、§23 が portal 実構築、§26 が固定列順版の実機確認、§27 がPerf対応・複数KQLの保存先分離、§28 がCSV命名・KQL追加手順、§30 が新命名・複数KQL版の実機確認と削除。§1～§21 は過去の計画・実績 |

顧客向け資料には現行方式の操作・仕様・受入条件だけを記載します。検討過程・過去方式・検証の詳細な時系列は提供者向けの設計・検証記録に保持し、customerから参照させません。新命名版のAzure実機確認と環境削除はdocs/plan.md §30、最終方式への資料整理は§31、既存LAWを参照する今回の資材・手順は§37、**同一サブスクリプション・別RGの既存LAWを使ったPortal実機検証と未確認範囲・後片付けの引き継ぎは§39**を参照してください。

## 公開根拠

- [Consumption の portal 作成](https://learn.microsoft.com/en-us/azure/logic-apps/quickstart-create-example-consumption-workflow)
- [Blob の Consumption＋システム MI による例外接続](https://learn.microsoft.com/en-us/azure/connectors/connectors-create-api-azureblobstorage#access-blob-storage-in-same-region-with-system-managed-identities)
- [Storage の Public 無効と例外の優先関係](https://learn.microsoft.com/ja-jp/azure/storage/common/storage-network-security-limitations)
- [信頼されたサービス一覧](https://learn.microsoft.com/ja-jp/azure/storage/common/storage-network-security-trusted-azure-services)
- [Consumption の MI 対応コネクタと V1 接続](https://learn.microsoft.com/en-us/azure/logic-apps/authenticate-with-managed-identity)
- [Monitor Logs の制限](https://learn.microsoft.com/en-us/azure/connectors/connectors-azure-monitor-logs)

公開資料の接続例は「選択したネットワークから有効」です。**今回の評価環境では初回から Disabled の接続に成功しましたが、導入先ごとに再確認し、失敗時に Public やキーを有効化しません。**
