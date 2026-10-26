# Consumption 受入確認・ダミーデータによるテスト

[入口](../README.md) / [導入](setup.md) / [運用・削除](operations.md)

## 1. 検証状態と最優先ゲート

| 証拠 | 現在の扱い |
|---|---|
| Consumption の配布資材の静的テスト | JSON / ARM / 接続・設定・出力契約・リンクを検査。Azure での実行を証明しない |
| 旧 Standard / WS1 の保存・独立読み戻し | 過去版の結果。Consumption の実績として流用しない |
| Consumption の ARM 実投入・接続・CSV 保存と読み戻し | **2026-10-22 確認済み**。4 / 0 / 1 件と同月再実行。読み戻しは実行内の Blob アクション |
| portal だけの構築・編集・実行 | **2026-10-22 確認済み**。3 段階 ARM の全文貼付、Publish、概要からの手動実行 |
| CSV 固定列順・ダミー明細／集計 | **2026-10-26 確認済み**。キー順が異なる入力、4 / 0 / 1 件、再実行、明細4列、集計3列。列設定不整合は保存前に停止 |
| 独立した CSV ファイル取得 | **未実施**。承認済み取得経路なし |
| 専用環境の削除 | **2026-10-26 に6資源と専用RGの削除完了**。portal の選択資源削除で成功6・失敗0、一覧0件。その後RGも削除し、成功通知と直接再表示の404を確認 |
| 初回から Public Disabled＋信頼されたサービス例外の接続 | **2026-10-22 確認済み**。一時公開・キー・制限解除タグは未使用 |

実行時は顧客管理下のコピーに結果・確認日・実行 ID・証拠・差異を記入します。未実施の項目を合格にしません。

顧客 KQL に変更する場合は [KQL パターンの変更と受入](query-patterns.md)を使います。明細・失敗のみ・操作別集計の例を同梱しています。2026-10-26 に `datatable` による明細・集計を実機確認しましたが、実際の AzureActivity テーブルや顧客 KQL の抽出・集計の正しさを確認したものではありません。

2026-10-26 の資材では CSV のカスタム列を明示し、入力 bag のキー順に依存しない列順に変更しています。同日に既存の専用 Consumption 環境へ反映し、下表の7ケースを実機確認しました。導入先でも下記ダミー試験に加え、bag のキー順を変えても同じ見出し・値の対応となることを確認してください。

### 列順固定版の実測（2026-10-26）

Southeast Asia の既存専用環境で、定義編集・Publish・手動実行を portal から実施しました。Storage は Public network access Disabled / Deny / AzureServices、Shared Key 無効、匿名無効を維持し、終了時の portal JSON でも確認しました。

| 試験 | 実行結果 | 保存済み CSV の実行内読み戻し |
|---|---|---|
| キー順の異なる bag、`2026-01` | Succeeded、5.33 秒 | 4 件、233 バイト。指定3列の見出し・値と期待CSVが全バイト一致 |
| 同じ入力、`2025-11` | Succeeded、3.18 秒 | 0 件、26 バイト。BOM＋指定順のヘッダー＋CRLF |
| 同じ入力、`2026-02` | Succeeded、4.02 秒 | 1 件、75 バイト。月境界を確認 |
| `2026-01` 再実行 | Succeeded、2.22 秒 | 4 件、233 バイト。初回と全バイト一致、current 書き込み成功 |
| カスタム列だけ逆順にした不整合 | Failed / SchemaMismatch、1.59 秒 | Upload CSV と Upload Current が Skipped。誤順のCSVを保存しない |
| `datatable` による明細4列 | Succeeded、3.07 秒 | 4 件、341 バイト。明示した4列と全値が期待CSVに一致 |
| 同じダミー4件を操作名・状態別に集計 | Succeeded、2.59 秒 | 2 行、105 バイト。指定3列、件数 1 / 3 が期待CSVに一致 |

最初の4ケースは JSON 文字列の bag を行ごとに異なるキー順とし、余分なキーも含めました。BOM・日本語・カンマ・引用符・埋込LFを含む期待CSVと、保存済みBlobの読み戻し本文を提供者側でバイト照合しました。1月は2026-10-22の実測CSVとも一致しました。1月初回と集計の Manifest 出力で期間・数値 rowCount・`csvReadBackVerified=true` を確認しています。集計の rowCount は元ログ4件ではなく、出力した2行です。

この7ケースとは別に、旧設定のまま実行した余分な Failed が1件ありました。公開前の全文確認不足であり、意図した明細4列の実行失敗ではありません。また、有効化直後にトリガーがまだ Disabled として HTTP 400 になった要求は run を生成していません。公開定義の確認・反映待ち後の再実行結果を上表に記載し、これらの操作失敗を隠したり実装不具合と混同したりしません。

独立ダウンロード、保存済み current の独立照合、実 AzureActivity、本番量、実月次は引き続き未確認です。試験後の専用RG削除は、確認名を入力しても portal の削除ボタンが有効化されず、再読み込み・閲覧UIの切り替え・英語表示でも解消しませんでした。有効なOwner権限と拒否割り当てなしを確認しましたが、原因は確定していません。無効なボタンの強制操作、CLI / REST への切り替えはしていません。

削除前に、ワークフローを元のダミーパラメーターと修正版の3列カスタム列へ戻して Publish しました。portal の公開済みリソースJSONでパラメーター・アクション・型定義・Recurrenceの一致と **Disabled / Succeeded**、履歴の Running なしを確認しました。その後、別の正規UIであるRG内一覧の「選択したリソースの削除」から、専用環境の6資源のみを削除しました。最終確認ダイアログ後の通知は **成功6・失敗0・キャンセル0**。一覧の検索条件は空、種類・場所はすべてで **0/0件** を確認しています。

**最終的に空のRG自体も削除完了しました。** 再サインイン・ブラウザー共有接続の復旧後、同じ空RGで確認名を入力して反映を待つと削除ボタンが有効になり、通常の削除操作と最終確認ダイアログを実行できました。RGの削除成功通知を確認し、元のRG URLを再読み込みして、対象RGの「見つかりません」・状態コード404を確認しました。再試行で成功した事実であり、当初ボタンが無効だった根本原因は特定していません。今回RG外の新規作成はなく、旧RG・旧WS1は未変更。閲覧プレビューは元の有効状態、表示も元の日本語です。実ID・成功通知・404の画像は私有記録とし、配布物には含めません。

### 提供者環境での実測（2026-10-22）

Southeast Asia の新規専用環境を Playwright で操作しました。実リソースの作成・定義更新・手動実行は portal 経由です。実 ID とスクリーンショットは私有作業ログへ保全し、配布物には含めません。

| 試験 | 実行結果 | 保存済み CSV の実行内読み戻し |
|---|---|---|
| `2026-01` | Succeeded、7.96 秒 | 4 件、Id=2/3/4/5、233 バイト。BOM・列順・日本語・カンマ・引用符・埋込改行 |
| `2025-11` | Succeeded、3.58 秒 | 0 件、26 バイト。BOM＋ヘッダー＋CRLF のみ |
| `2026-02` | Succeeded、2.65 秒 | 1 件、Id=6、75 バイト。翌月の開始境界を含む |
| `2026-01` 再実行 | Succeeded、2.51 秒 | 別 run の CSV が初回と全バイト一致。新 run を指す current の書き込み成功 |
| `COLUMNS=["WrongColumn"]` | Failed、2.26 秒 | Check_Record_Columns の ValidationFailed。Upload_Current は Skipped |
| 不正 KQL | Failed、1.89 秒 | Query の HTTP 400 / SyntaxError。Upload_Current は Skipped |

4 / 0 / 1 件の Manifest 出力で対象月・UTC 窓・数値 rowCount・`csvReadBackVerified=true` を確認しました。BOM・全バイトの詳細照合は、portal の読み戻し出力を基にした**提供者側の検査**です。操作者の Storage ブラウザーからの独立ダウンロード成功とは扱いません。

試験後は元のダミー設定へ戻し、portal のリソース JSON で **Disabled / Succeeded** を確認しました。パラメーター・型・アクション・Recurrence が試験前と一致しています。旧 run の実 Blob 再取得、異常系後の保存済み current の独立再取得、公開クライアント拒否の切り分け、削除は未実施です。

**前提**：[導入手順](setup.md)の 3 段階を完了し、Consumption のシステム MI・管理接続 2 個・RBAC が反映済みであること。Public network access Disabled、Shared Key 無効、匿名無効、AzureServices 例外を維持すること。保存に失敗しても、キーや Public 有効化へ切り替えません。

## 2. 実データ不要のダミーテスト

`datatable` がその場で 6 件を生成します。ログ取り込み・テーブル作成・診断設定・過去ログは不要です。実際の LAW と Blob を使うため、オフラインの模擬試験ではありません。

### A. パラメーターを設定する

1. Logic App を**無効化**し、概要の **Status Disabled** と実行履歴に Running がないことを確認する。無効化のボタンを押しただけで画面遷移しない。現在のパラメーター・開始日時・有効状態を台帳に控える。
2. **パラメーター**または **コード ビュー**で次を設定する。Standard の環境変数・アプリ設定は使わない。接続参照 `$connections` は保持する。

   | 名前 | 値 |
   |---|---|
   | LAW_RESOURCE_ID | 導入時の LAW の ARM リソース ID |
   | STORAGE_ACCOUNT_NAME | 導入時の保存用 Storage 名 |
   | MONTH_OVERRIDE | `2026-01` |
   | COLUMNS | **配列** `["TimeGenerated","Id","Text"]`。文字列へ変換しない |
   | KQL_BODY | 下記全文。[sample.json](../settings/sample.json)の KQL と同じ |

   別パターンからダミーへ戻す場合は、`Export → Create_CSV_table` のカスタム列も [sample.csv-columns.json](../settings/sample.csv-columns.json) の順・値の式へ戻します。パラメーターだけ戻してカスタム列を残さないでください。

   KQL 入力欄には外側の JSON の引用符ではなく、以下のクエリそのものを貼り付けます。`start` / `end` はワークフローが付加するため宣言しません。

   ```kusto
   datatable(TimeGenerated:datetime, Id:int, Text:string)[
     datetime(2025-12-31T14:59:59Z),1,"before window",
     datetime(2025-12-31T15:00:00Z),2,"start boundary",
     datetime(2026-01-15T03:04:05Z),3,"comma, quote \" and 日本語",
     datetime(2026-01-20T00:00:00Z),4,"line1\nline2",
     datetime(2026-01-31T14:59:59Z),5,"end boundary last",
     datetime(2026-01-31T15:00:00Z),6,"next month first"
   ]
   | where TimeGenerated >= start and TimeGenerated < end
   | project TimeGenerated, Id, Text
   | project bag=pack_all()
   ```

3. 保存前にエディターへフォーカスし、意図した全文だけになっていること、KQL・列・カスタム列・対象月・接続が正しいことを確認する。貼付で旧内容が残ったり、JSONが二重になったりしていないことを確認する。自動保存のエラーがなくなった後、**Publish** の完了・成功通知を確認し、再度開いて値を確認する。Draft の自動保存だけで終了しない。保存後も概要の有効状態を再確認し、試験直前まで Disabled とする。配布 JSON の内部プロパティを手入力する際は、型や `$connections` を壊さない。
4. Query の時間範囲が **Set in query**、Recurrence が将来日時で **Tokyo Standard Time**、同時実行数が 1 と確認する。

### B. 月次を待たずに手動実行する

1. Logic App を有効化する。有効化時の想定外の実行がないか確認し、Running があれば待つ。概要が Enabled でもトリガーの反映待ちで Disabled の HTTP 400 になる場合がある。明確な受付失敗と新runがないことを確認できた場合だけ、反映を待ち Refresh 後に再試行する。受付済み・結果不明の要求は無条件に再送しない。
2. 概要の **実行 / トリガーの実行**から 1 回だけ実行する。英語画面では **Run → メニュー内の Run**。デザイナーの **Run draft** は本手順では使わない。毎月 5 日を待つ必要はない。実行できなければ停止し、CLI に切り替えない。
3. **Refresh** で実行履歴を更新し、新しい実行 ID と最終状態を確認する。トリガー受付の成功通知だけでは実行完了と判定しない。Running 中に再実行しない。
4. Export の `QueryText` で公開された実際の KQL・期間を確認し、件数・CSV 保存・読み戻し・manifest / current のアクションを開く。編集画面の表示だけで反映済みと判断しない。

   | 項目 | 期待値 |
   |---|---|
   | Month | `2026-01` |
   | StartUtc | `2025-12-31T15:00:00` |
   | EndUtc | `2026-01-31T15:00:00` |
   | RowCount | 数値の `4` |
   | 保存と読み戻し | 成功し、CSV 本文が一致。アップロード入力だけでは判定しない |
   | manifest / current | 同じ対象月・runId・相対パス |

5. 評価中は再度無効化する。Failed は失敗アクション・エラー・設定値の差異を記録し、[障害対応](operations.md#4-失敗時の扱い)に従う。

### C. 保存済み CSV を確認する

Blob の読み戻しアクションは**実際に保存されたデータ**を取得していることを確認します。CSV のアップロード入力、Succeeded、201 応答だけでは保存内容の一致を証明しません。

1. 読み戻した CSV 本文が `TimeGenerated,Id,Text` の列順で、次の 4 件を含むことを確認する。順序ではなく Id と値で照合する。Id=1 と 6 は含まれない。
2. UTF-8 BOM、日本語、カンマ、二重引用符、埋め込み改行を確認する。表示で BOM を判断できなければ未確認として記録する。
3. 保存済み current → その path の manifest → CSV を独立に取得する確認と、実行内の読み戻しを区別する。独立取得は[承認済みの取得経路](operations.md#3-csv-の取得と完了判定)で実施し、経路がなければ未実施とする。

| Id | TimeGenerated（UTC） | Text |
|---|---|---|
| 2 | `2025-12-31T15:00:00Z` | `start boundary` |
| 3 | `2026-01-15T03:04:05Z` | `comma, quote " and 日本語` |
| 4 | `2026-01-20T00:00:00Z` | `line1` と `line2` の間に実際の改行 |
| 5 | `2026-01-31T14:59:59Z` | `end boundary last` |

CSV は値中に改行があるため、テキストの改行数を件数にしません。ファイルとして取得した場合は、承認された CSV 対応ソフトで数式の自動実行・日付変換を避けて取り込みます。**実行履歴で本文を確認しただけでは、CSV ファイルをダウンロードできたとは記録しません。**

CSV の列順は KQL の project と COLUMNS の順を一致させます。`Check_Header` は列順の違いも失敗として検出します。オフラインハーネスの列順と実サービスの生成順が一致することは、実機でも確認してください。

実行詳細でアクションが見つからない場合は **Search workflow actions** から `Read Back CSV`、`Manifest`、`Upload Current` などを選びます。`Read_Back_CSV` の出力 Body は `$content-type` と base64 の `$content` を含むバイナリ本文です。データが表示されてから確認・コピーし、未読込の `{}` を実データと扱わないでください。未加工出力を開く場合は、署名付き URL や応答ヘッダーを作業ログへ転載しません。

### D. 0 件・翌月境界・再実行

無効化 → Running なし → MONTH_OVERRIDE の変更・保存 → 有効化・1 回実行 → 保存・読み戻し確認 → 無効化を毎回行います。KQL と COLUMNS は変えません。

| MONTH_OVERRIDE | UTC 窓（開始以上・終了未満） | 期待値 |
|---|---|---|
| `2025-11` | `2025-10-31T15:00:00` ～ `2025-11-30T15:00:00` | 0 件。BOM＋ヘッダー＋改行のみ |
| `2026-02` | `2026-01-31T15:00:00` ～ `2026-02-28T15:00:00` | 1 件。Id=6 / `next month first` |
| `2026-01` の再実行 | 1 月の窓 | 新 run と current。旧 run の CSV / manifest は不変 |

0 件は正常応答の `value: []` の場合だけです。本文欠損・必須 bag 欠損・Parse JSON エラー・PartialError を 0 件に読み替えません。

### E. 異常系と終了

1. 直前成功の current を控え、COLUMNS を配列 `["WrongColumn"]` にして実行し、Failed を確認する。current が前回成功を指すことを実データで確認する。
2. COLUMNS を戻し、不正 KQL で Failed を確認する。設定を正しいダミーへ戻す。
3. current 更新そのものが失敗した場合は、書き込まれた可能性を含めて再取得し、結果を推測しない。
4. 評価終了時は無効化する。MONTH_OVERRIDE を空にするだけで本番化しない。保持するか[削除するか](operations.md#5-後片付け)を台帳に記録する。

## 3. 受入確認表

各項目に「結果・確認日・証拠・差異」を追記してください。以下は提供者環境の 2026-10-22 と 2026-10-26 の結果であり、顧客環境の合格を代替しません。

| 項目 | 合格条件 | 提供者環境の結果 |
|---|---|---|
| 初回ネットワーク設定 | 初回から PNA Disabled / Deny / AzureServices。共有キー・匿名無効 | 確認済み。portal JSON と実保存・読み戻し |
| 最小構成 | Consumption 1、Storage 1、接続 2、LAW 1。実行用 VNet / PE / DNS / ホストなし | 3 段階の実デプロイ成功 |
| MI 認証 | システム MI と exports / LAW の限定ロール。ユーザーログイン・キーなし | MI・限定 RBAC 投入と実接続成功、LAW IAM 確認。exports IAM 画面の直接確認は未実施 |
| portal の構築・保存 | 3 段階投入、定義・値・接続の表示と再保存が成功 | 構築・対象月変更・Publish・復元を確認。接続リソース個別の JSON と Query の選択肢表示は未確認 |
| ダミーの保存と読み戻し | 4 / 0 / 1 件、全値・BOM・列順・JSON 型・対象期間が一致 | 実行内の保存済み CSV 読み戻しと提供者側バイト検査で確認 |
| 固定列順・列構成の変更 | bag のキー順に依存せず、明示した列順と値の対応を維持 | 10/26 に異なるキー順・余分なキー、明細4列・集計3列を実機確認。不整合は SchemaMismatch で保存前停止 |
| 同月再実行 | 新しい run と current、旧 run 保持。重複実行をしない | 新 run・CSV 一致・current 書込成功。旧 Blob の独立再取得は未実施 |
| 異常応答・権限不足 | 明示的 Failed、有限リトライ、未完了成果物を採用しない | 列不一致・不正 KQL の Failed と current 更新 Skipped を確認。権限不足・通信障害・保存済み current の独立照合は未実施 |
| 通常の公開クライアント拒否 | 有効な Entra データ権限があってもネットワークで拒否。認証不足の 403 と区別 | 未実施 |
| 独立取得・CSV ファイル取得 | 承認済み経路で current → manifest → CSV を取得・照合 | 未実施 |
| 定期発火・排他 | 初回・次回予定、同時実行数 1。短周期と実月次観測を区別 | 将来 startTime / JST / 同時実行1を JSON で確認。実月次・競合実行は未実施 |
| 削除 | 専用環境だけを削除し、RG 外も残存なし | 10/26 に選択資源の削除で成功6・失敗0、一致条件なしの一覧0件。その後RGも portal から削除し、成功通知と元URL再読み込みの404を確認。今回RG外の新規作成なし |

## 4. 本番化前の条件

実テーブル・KQL・列、月次件数・サイズ、100 秒以内のクエリ、保持・遅延取り込み・再抽出、分割、監視通知、履歴の機密性・保持、例外許可と取得経路を承認します。自動分割、実月次発火、50 万行の境界、PartialError 実発生、再送を含む排他、本番性能は未検証です。

## 公開情報

- [datatable](https://learn.microsoft.com/en-us/kusto/query/datatable-operator?view=azure-monitor)
- [Monitor Logs の制限](https://learn.microsoft.com/en-us/azure/connectors/connectors-azure-monitor-logs)
- [QueryDataV2](https://learn.microsoft.com/en-us/connectors/azuremonitorlogs/)
- [API の部分応答](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/api/response-format)
- [Logic Apps の制限・再試行・同時実行](https://learn.microsoft.com/en-us/azure/logic-apps/logic-apps-limits-and-config)
- [実行履歴の Secure Inputs / Outputs](https://learn.microsoft.com/en-us/azure/logic-apps/set-up-security-permissions#secure-data-in-run-history)
- [Log Analytics の保持](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/data-retention-configure)
