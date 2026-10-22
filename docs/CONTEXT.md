# プロジェクトコンテキスト

## 現在の目的・採用構成

Azure Log Analytics の前月ログを毎月 5 日 09:00 JST に抽出し、CSV として Storage に保存する。2026-10-22 の指示により、**顧客向け資料を含む現行資材を Logic Apps Consumption に統一**した。過去の ASE / WS1 は現行の採用構成ではない。

顧客向け入口は [customer/README.md](../customer/README.md)、生成・テストは [customer-maintenance.md](customer-maintenance.md)。[plan.md](plan.md) §22 が今回の切替、§23 が portal 実構築と検証。§1～§21 は過去の計画・検証・再検討の履歴である。

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
- [Storage の注意事項](https://learn.microsoft.com/ja-jp/azure/storage/common/storage-network-security-limitations)は Disabled 後も既存例外が有効と説明するが、公式の Blob 手順は「選択したネットワークから有効」を例示する。**2026-10-22 の新規 Consumption 環境では初回から Disabled / keyless の保存・実行内読み戻しに成功**した。導入先ごとに同じ接続ゲートを確認する。
- [MI 対応コネクタと V1 接続](https://learn.microsoft.com/en-us/azure/logic-apps/authenticate-with-managed-identity)に従う。portal の3段階投入、定義の Publish、ダミー設定変更・復元と実接続を確認した。接続リソースの個別 JSON、Query の選択肢表示の照合は未確認。
- [Monitor Logs](https://learn.microsoft.com/en-us/azure/connectors/connectors-azure-monitor-logs)の上限は約 16 MiB、500,000 行、100 秒 / 110 秒。Basic / Auxiliary 非対応。自動分割は未実装。
- [Storage の portal 認可](https://learn.microsoft.com/en-us/azure/storage/blobs/authorize-data-operations-portal)とネットワーク制限は別。操作者は Logic App の例外を使えない。実行履歴で本文を見ることと、保存済み CSV ファイルの取得成功を同一視しない。
- 実月次発火、本番量、PartialError 実発生、再送を含む排他、独立読み戻し・実ファイル取得、履歴機密性は未検証。現在の [受入確認](../customer/docs/validation.md)に結果を蓄積する。

## Consumption 実機結果（2026-10-22）

- Playwright で専用 RG と3段階 ARMを実投入。Storage / LAW / workflow の portal JSON を私有保全し、LAW IAM も確認した。実構築・編集・手動実行を CLI / REST で代替していない。
- ダミー4 / 0 / 1件と1月再実行が Succeeded。保存済み Blob の Read_Back_CSV と不一致チェックを通過。BOM・特殊文字・列順・月境界と233 / 26 / 75バイトを提供者側で検査した。再実行のCSV本文は初回と全バイト一致し、同月current書き込みも成功。
- 列不一致は Check_Record_Columns の ValidationFailed、不正KQLは Query の HTTP400 / SyntaxError。どちらも Failed で Upload_Current は Skipped。保存済み current の独立再取得は未実施であり、不変を実データ照合済みとはしない。
- 元のパラメーター・型・アクション・Recurrenceへ復元。最後に portal JSONで Disabled / Succeeded を確認。削除は未承認のため保持し、旧RG・WS1は未変更。
- スクリーンショット36枚と詳細作業ログは私有保存。実ID・ユーザー名・生画像をコミットしない。

## 過去実績との区別

旧 ASE / WS1 では、キーなし起動・再起動、実データ照合、4 / 0 / 1 件の保存と独立読み戻し、不正 KQL 等を確認した。ただし **Consumption の実績には流用しない**。旧資材・操作スクリプトを現行の手順から除いた。

2026-10-21 の旧 WS1 の後片付けでは、保持予定の空プランまで最後のサイトと連動削除された。元宣言を再投入して同名で復旧したが、元リソースを無変更保持できたわけではない。[Web Apps Delete](https://learn.microsoft.com/en-us/rest/api/appservice/web-apps/delete?view=rest-appservice-2024-04-01)の `deleteEmptyServerFarm=false`、事前 GET 全文保全・削除後直接比較を今後も守る。今回の Consumption 変更では旧プランを操作しない。

## 次の受入

1. 承認済み CSV 取得経路を確定し、保存済み current → manifest → CSV と旧 run を独立照合する。
2. exports IAM 画面、接続の個別 JSON、Query の選択肢表示、正しいデータ権限を持つ公開クライアントの拒否を確認する。
3. 本番量・実月次・競合と再送・権限不足・通信障害、監視・保持・履歴機密性を確認する。
4. 削除承認を得てから専用環境と RG 外の今回作成分を削除・残存確認する。
