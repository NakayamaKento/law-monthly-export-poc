# プロジェクトコンテキスト

## 現在の目的・採用構成

Azure Log Analytics の前月ログを毎月 5 日 09:00 JST に抽出し、CSV として Storage に保存する。2026-10-22 の指示により、**顧客向け資料を含む現行資材を Logic Apps Consumption に統一**した。過去の ASE / WS1 は現行の採用構成ではない。

顧客向け入口は [customer/README.md](../customer/README.md)、生成・テストは [customer-maintenance.md](customer-maintenance.md)。[plan.md](plan.md) §22 が今回の切替、§1～§21 は過去の計画・検証・再検討の履歴である。

## 要件と制約

- 顧客操作は **Azure portal のみ**。CLI、Cloud Shell、ローカルコマンド、Run Command を求めない。
- Storage のネットワーク設定で **Public を拒否**する。「閉域化」は Private Endpoint 必須という意味ではないと 2026-10-21 に明確化された。
- 初回から PNA Disabled / Deny / 信頼されたサービスの例外 AzureServices、Shared Key false、匿名 false を使う。失敗時に一時公開やキーで回避しない。
- MI とデータ RBAC が必要。例外は公開エンドポイントへの許可で、Private Endpoint 通信とは異なる。
- LAW は閉域対象外。公開クエリは許可し、公開取り込みは不要なため無効のまま。
- 実行専用 VM は不可。Functions は優先しない。Automation の旧不採用判断は過去の PE 前提に基づくが、今回再比較・採用はしない。
- CSV 形式、月境界、0 件、特殊文字、BOM を保持。本番テーブル・量・保持・遅延取り込み・通知・取得経路は顧客の承認が必要。
- 有償リソースの新規作成は構成・費用・権限・削除範囲の承認後に専用 RG で実施し、RG 外の今回作成物も後片付けする。
- 実環境 ID・ユーザー名・資格情報をコミットしない。

## 現行の最小構成

| 資源 | 用途 |
|---|---|
| Consumption ワークフロー 1 | システム MI、初期 Disabled、Recurrence、履歴 |
| 保存用 Storage 1 / exports 1 | CSV / manifest / current。ホスト用途なし |
| 管理 API 接続 2 | Monitor Logs と Blob。双方 MI、Consumption 用 V1 |
| 評価用 LAW 1 | ダミー KQL 実行。ログ取り込み不要 |
| アプリ MI のロール 2 | LAW Reader、exports の Blob Data Contributor |

WS1 / App Service プラン、ホスト UAMI、ホスト用 Queue / Table、実行用 VNet / PE / DNS、Files、AMPLS、ASE、VM / Bastion / NAT は作らない。CSV 取得用の既存ネットワークは別条件として扱い、この削減を理由に削除しない。

Consumption の Blob は**管理コネクタ**。期間計算・CSV・条件・Parse JSON は組み込み。HTTP による REST の直書きなし。`appsetting()` ではなくワークフローパラメーターを使う。

## 公開根拠と未検証点

- [Blob の Consumption＋システム MI](https://learn.microsoft.com/en-us/azure/connectors/connectors-create-api-azureblobstorage#access-blob-storage-in-same-region-with-system-managed-identities)は信頼されたサービス例外を案内する。ユーザー割り当て MI をこの方式に使わない。
- [Storage の注意事項](https://learn.microsoft.com/ja-jp/azure/storage/common/storage-network-security-limitations)は Disabled 後も既存例外が有効と説明するが、公式の Blob 手順は「選択したネットワークから有効」を例示する。**初回から Disabled の接続は未実証**で、最優先の実機ゲート。
- [MI 対応コネクタと V1 接続](https://learn.microsoft.com/en-us/azure/logic-apps/authenticate-with-managed-identity)に従う。実際の portal 作成・編集保存・接続認可は未実施。
- [Monitor Logs](https://learn.microsoft.com/en-us/azure/connectors/connectors-azure-monitor-logs)の上限は約 16 MiB、500,000 行、100 秒 / 110 秒。Basic / Auxiliary 非対応。自動分割は未実装。
- [Storage の portal 認可](https://learn.microsoft.com/en-us/azure/storage/blobs/authorize-data-operations-portal)とネットワーク制限は別。操作者は Logic App の例外を使えない。実行履歴で本文を見ることと、保存済み CSV ファイルの取得成功を同一視しない。
- 実月次発火、本番量、PartialError 実発生、再送を含む排他、独立読み戻し・実ファイル取得、履歴機密性は未検証。現在の [受入確認](../customer/docs/validation.md)に結果を蓄積する。

## 過去実績との区別

旧 ASE / WS1 では、キーなし起動・再起動、実データ照合、4 / 0 / 1 件の保存と独立読み戻し、不正 KQL 等を確認した。ただし **Consumption の実績には流用しない**。旧資材・操作スクリプトを現行の手順から除いた。

2026-10-21 の旧 WS1 の後片付けでは、保持予定の空プランまで最後のサイトと連動削除された。元宣言を再投入して同名で復旧したが、元リソースを無変更保持できたわけではない。[Web Apps Delete](https://learn.microsoft.com/en-us/rest/api/appservice/web-apps/delete?view=rest-appservice-2024-04-01)の `deleteEmptyServerFarm=false`、事前 GET 全文保全・削除後直接比較を今後も守る。今回の Consumption 変更では旧プランを操作しない。

## 次の受入

1. 承認後に、専用環境を初回から Disabled / keyless で作成し接続ゲートを確認。
2. Consumption でダミー 4 / 0 / 1 件、再実行、異常系、保存済み Blob 独立照合。
3. portal 完結と承認済み CSV 取得経路を実証。本番量・監視・保持を確定。
4. 専用環境と RG 外の今回作成分を削除・残存確認する。
