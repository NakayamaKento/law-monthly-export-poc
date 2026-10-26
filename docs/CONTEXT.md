# プロジェクトコンテキスト

## 現在の目的・採用構成

Azure Log Analytics の前月ログを毎月 5 日 09:00 JST に抽出し、CSV として Storage に保存する。2026-10-22 の指示により、**顧客向け資料を含む現行資材を Logic Apps Consumption に統一**した。過去の ASE / WS1 は現行の採用構成ではない。

顧客向け入口は [customer/README.md](../customer/README.md)、生成・テストは [customer-maintenance.md](customer-maintenance.md)。[plan.md](plan.md) §22 が切替、§23 が portal 実構築、§26 が列順固定版の実機確認、§27 がPerf対応・複数KQLの保存先分離、§28 がCSV命名・KQL追加手順、§30 が新命名・複数KQL版の実機確認と削除。§1～§21 は過去の計画・検証・再検討の履歴である。

**顧客共有の方針（2026-10-27）**：最終の現行方式だけを共有する。customerの5文書は構成・導入・ダミー試験・KQL設定／追加・運用・取得・削除・受入条件に集中し、旧方式・移行・検討過程・提供者の詳細な検証履歴を除いた。確認範囲と未確認の受入条件は残し、試行錯誤・実測の時系列は本書とplanに保全する。customerから内部資料へ誘導しない。§31参照。

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
| Consumption ワークフロー KQLごとに1 | システム MI、初期 Disabled、Recurrence、履歴 |
| 保存用 Storage 1 / exports 1 | CSV / manifest / current。ホスト用途なし |
| 管理 API 接続 ワークフローごとに2 | Monitor Logs と Blob。双方 MI、Consumption 用 V1 |
| 評価用 LAW 1 | ダミー KQL 実行。ログ取り込み不要 |
| アプリ MI のロール ワークフローごとに2 | LAW Reader、exports の Blob Data Contributor |

WS1 / App Service プラン、ホスト UAMI、ホスト用 Queue / Table、実行用 VNet / PE / DNS、Files、AMPLS、ASE、VM / Bastion / NAT は作らない。CSV 取得用の既存ネットワークは別条件として扱い、この削減を理由に削除しない。

Consumption の Blob は**管理コネクタ**。期間計算・CSV・条件・Parse JSON は組み込み。HTTP による REST の直書きなし。`appsetting()` ではなくワークフローパラメーターを使う。

2026-10-25 に [KQL パターンの変更ガイド](../customer/docs/query-patterns.md)と明細・失敗のみ・操作別集計の設定例、貼り付け用 `.kql` の生成を追加。当時は1ワークフロー内の切り替えだけで保存先分離は未実装だった。顧客は `KQL_BODY` と `COLUMNS` を対で変更し、通常の `MONTH_OVERRIDE=""` による前月計算は共通で使う。

**2026-10-26の複数KQL対応**：Perfの `% Processor Time` 日次平均の設定・カスタマイズ手順を追加。固定日付をstart/endへ置換し、平均列をAvgCounterValueと明示、4列のCSVマッピングを同梱。元の `bin(TimeGenerated, 1d)` はUTC日単位で維持し、JST暦月との境界の違いを説明する。複数KQLは1KQL1ワークフローをそれぞれ月次実行し、Storage Account・exports・LAWは共有。第1段階は1回、第2・3段階はKQLごと。ワークフロー名を識別名として `exports/<workflowName>/<YYYY-MM>/...` にCSV・manifest・currentを分離し、manifest/currentにもworkflowNameを記録する。共有Storage Account内で名前を一意にする。旧パスを自動移行せず、利用側参照を変更して受入する。プレフィックスはRBAC境界ではない。1ワークフローでの複数KQL一括処理は実装しない。追加時点の検査はオフラインのみで、その後の実機結果は§30に分けて記載する。

**命名改善**：CSV名を `<workflowName>_<対象月>_<実行日時yyyyMMdd-HHmmss>-JST.csv` に変更。用途名はworkflowNameで指定し、実行IDをCSV名から外す。格納先は `runs/<実行日時JST>_<run-id>/` とし、可読性と同一秒の衝突防止を両立する。時刻はRunStartedUtcで1回だけ取得し、月計算・名前生成で共用。manifest.filesとcurrent.csvFileNameは実際のCSV名、current.pathは新しいフォルダーを指す。KQL追加のARM入力／ワークフローパラメーター対応表、メモリKQL追加例、既存更新・取得処理の移行を手順に記載。§28参照。

**2026-10-27の新命名・複数KQL版の実機確認**：明示承認後、portalから新規専用RGに2本・共通Storage / LAW・接続4・MIロール4を構築。初回からStorage Disabled / keylessを維持し、固定3 / 4列、Perfダミーの平均20 / 50、4 / 0 / 1件、再実行、SchemaMismatchでの保存前停止を8ケース（成功7・想定失敗1）で確認した。成功CSVは233 / 187 / 26 / 75 / 55バイトで期待値と一致し、開始UTC→JSTの新命名も一致。再実行時だけ検証専用のBlob読み取り3＋Compose 1を追加し、自currentの新run参照、列不整合失敗後・別KQL再実行後も変わらない他current、旧CSVの保持を保存実体で照合した。追加アクションは配布物には含めない。実Perf・独立ダウンロード・本番量・実月次・実機の同一秒／時計境界は未確認。2本を無効化しRunningなし、Storageの初期・終了設定一致を確認後、今回の専用RGと8資源を削除した。削除成功通知と元URLの新規読み込み404を保全。RG外の今回作成物なし、既存環境未変更。55枚の画像・実ID・JSON / CSV・検証ログは非公開作業フォルダーのみ。§30参照。

**2026-10-26 の列順固定要件への対応**：上記の変更手順を補足し、列構成を変える場合は `Create_CSV_table.inputs.columns` のカスタム列も変更する。初回 ARM は入力 `columns` から生成し、構築後用には `.csv-columns.json` を同梱。`pack_all()` のキー順や Table の自動列推定に依存せず、カスタム列配列で毎月の列順・値の対応を固定する。従来はキー順の相違を Check_Header で失敗にしていたが、現在は相違を許容して指定順で出力する。ヘッダー検査・必須列検査は維持。同日に既存専用環境へ反映し、キー順が異なる bag の4/0/1件・再実行、ダミー明細4列・集計3列の期待CSV全バイト一致、不整合時の保存前停止を実機確認した。実 AzureActivity・本番KQLの検証とは区別する。

試験後は元ダミーパラメーターと修正版カスタム3列へ戻して Publish。公開済みリソースJSONでパラメーター・アクション・型定義・Recurrenceの一致、Disabled / Succeededを照合し、Runningなしを確認した。その後、portal の選択資源削除で専用環境の6資源を削除し、成功6・失敗0、一致条件なしの一覧0件を確認。一時残存した空RGも、再サインイン・ブラウザー共有接続復旧後の再試行で削除できた。成功通知と元のRG URL再読み込みによる対象RGの404を確認し、後片付けは完了した。削除ボタンが当初無効だった原因は未特定。

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
専用環境の後片付けは2026-10-26に完了。承認範囲の6資源と空RGを portal で削除し、成功通知とRGの404を確認した。今回RG外の新規作成なし、旧RG・旧WS1は未変更、UI設定は元へ復元済み。CLI / REST や無効ボタンの強制操作で迂回していない。
