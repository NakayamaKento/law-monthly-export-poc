# 前月分 KQL のパターンを変更する（Azure portal のみ）

[入口](../README.md) / [導入](setup.md) / [受入確認](validation.md) / [運用](operations.md)

**取得条件だけなら `KQL_BODY`、列構成も変える場合は `COLUMNS` と CSV のカスタム列設定も変更します。** 接続、期間計算、Blob 保存アクションは共通です。CSV の列順は明示的なカスタム列配列で固定し、`pack_all()` のキー順には依存しません。パターンは以下の例を出発点に、顧客の既存 KQL に置き換えてください。AzureActivity は説明用であり、本番の対象テーブルを指定するものではありません。

## 1. 月ごとに変更しない設定

| 項目 | 通常運用の設定・動作 |
|---|---|
| MONTH_OVERRIDE | **空文字 `""`**。実行時点の日本時間から前月を選択 |
| 期間 | 前月 1 日 00:00 以上、当月 1 日 00:00 未満（JST） |
| start / end | ワークフローが上記の境界を UTC に変換し、KQL の先頭に自動追加 |
| 月の日数 | 28 / 29 / 30 / 31 日を自動処理。固定の「過去 30 日」ではない |
| 実行日 | 配布例は毎月 5 日 09:00 JST。顧客の月初業務日に変える場合は Recurrence の開始日時・次回予定を別途確認 |

たとえば 2026 年 3 月の実行では、2 月 1 日 00:00 JST 以上～3 月 1 日 00:00 JST 未満です。2028 年なら 2 月 29 日も含みます。日数を毎月手入力する必要はありません。

手動で過去月を再取得する場合だけ `MONTH_OVERRIDE` に `2026-01` などを指定し、終了後は空文字へ戻します。再送時も実行時点で期間を計算するため、月をまたいで再実行する場合は対象月を明示してください。

## 2. パターンを選ぶ

`.kql` は **KQL_BODY の入力欄にそのまま貼る本文**です。`.json` は KQL と列を対にしたワークフローパラメーターの参考設定です。ファイルを置くだけで自動選択される仕組みではありません。

| パターン | 貼り付け用 KQL | 対応する設定 JSON | 用途 |
|---|---|---|---|
| ダミー | [sample.kql](../settings/sample.kql) | [sample.json](../settings/sample.json) | 実データなしの接続・CSV 試験。対象月は `2026-01` |
| 明細 | [azureactivity.kql](../settings/azureactivity.kql) | [azureactivity.json](../settings/azureactivity.json) | 前月の操作履歴を 1 ログ 1 行で出力 |
| 失敗のみ | [azureactivity-failures.kql](../settings/azureactivity-failures.kql) | [azureactivity-failures.json](../settings/azureactivity-failures.json) | 前月の `ActivityStatusValue` が `Failed` の明細 |
| 操作別集計 | [azureactivity-summary.kql](../settings/azureactivity-summary.kql) | [azureactivity-summary.json](../settings/azureactivity-summary.json) | 前月の操作名・状態ごとの件数 |

CSV のカスタム列設定（列構成を変更する場合に使用）：

- [ダミー](../settings/sample.csv-columns.json)
- [明細](../settings/azureactivity.csv-columns.json)
- [失敗のみ](../settings/azureactivity-failures.csv-columns.json)
- [操作別集計](../settings/azureactivity-summary.csv-columns.json)

毎月同じパターン・列設定を使う限り、0件でも非0件でもCSVの列順は同じです。初回の第2段階ARM投入では `columns` 入力からカスタム列設定も生成します。デプロイ後にパラメーター `COLUMNS` を変更するだけでは、アクション定義のカスタム列は自動更新されません。

明細・失敗のみの `COLUMNS`：

```json
["TimeGenerated","OperationNameValue","ActivityStatusValue","CategoryValue"]
```

操作別集計の `COLUMNS`：

```json
["OperationNameValue","ActivityStatusValue","RecordCount"]
```

### 例 A：明細から失敗だけに絞る

変更箇所は時間条件の次に追加する `where` です。出力列が同じなら `COLUMNS` は変更しません。

```kusto
AzureActivity
| where TimeGenerated >= start and TimeGenerated < end
| where ActivityStatusValue =~ "Failed"
| project TimeGenerated, OperationNameValue, ActivityStatusValue, CategoryValue
| project bag=pack_all()
```

### 例 B：前月分を操作名・状態で集計する

**月の絞り込みを集計より前に行います。** 明細と異なる列になるため `COLUMNS` も変更します。

```kusto
AzureActivity
| where TimeGenerated >= start and TimeGenerated < end
| summarize RecordCount=count() by OperationNameValue, ActivityStatusValue
| project OperationNameValue, ActivityStatusValue, RecordCount
| project bag=pack_all()
```

この場合、manifest の `rowCount` は **集計後の CSV 行数**です。元ログ件数ではありません。元ログ件数は `RecordCount` に出力します。グループ付き集計なので入力 0 件なら出力も 0 行です。グループなしの `summarize count()` は入力 0 件でも 1 行を返すため、顧客 KQL の期待値を別途決めます。

## 3. 顧客の既存 KQL を使う

以下の 3 箇所を顧客の業務に合わせます。

```kusto
<対象テーブル>
| where <UTC の日時列> >= start and <UTC の日時列> < end
// ここに顧客の抽出条件・集計を入れる
| project <CSV に出す列を順番に列挙>
| project bag=pack_all()
```

山括弧の箇所を実際の名前へ置換します。これは説明用のひな形で、そのままでは実行できません。

- 既存の `ago(30d)`、`now()` や固定日付による対象期間指定は、上記の `start` / `end` を使う条件へ置き換える。`let start` / `let end` はワークフローが付加するので本文に重複宣言しない。
- 時間条件は対象の日時列に適用する。`join` / `union` 等で別テーブルも参照する場合は、その入力にも必要な期間条件を適用する。任意の KQL 全体へワークフローが自動で時間フィルターを挿入するわけではない。
- 最後から 2 行目の `project` と `COLUMNS` の名前・列順を一致させる。集計後に `TimeGenerated` がなくても、出力列を合わせればよい。
- `Create_CSV_table` のカスタム列配列も同じ順にする。各要素の `header` は列名、`value` は `@item()['列名']`。プロパティバッグ内のキー順は保証されないため、CSV の「自動」列設定は使用しない。余分な入力キーはCSVに出さず、必要列の不足は従来の検査で失敗させる。
- 最後の `| project bag=pack_all()` はコネクタ応答を共通化するため残す。CSV に `bag` という列を出す意味ではない。
- `COLUMNS` は重複のない文字列配列。列名にはカンマ・引用符・改行を避け、単純な名前を使う。列不足やヘッダー不一致は失敗として扱い、検査を削除して回避しない。
- 対象テーブルの存在、Analytics プラン、MI の閲覧権限、取り込み・保持期間を確認する。評価 LAW には実データの AzureActivity があるとは限らない。実データがなければ[ダミー試験](validation.md#2-実データ不要のダミーテスト)を使う。
- 約 16 MiB / 500,000 行 / クエリ 100 秒・コネクタ 110 秒の制限と、サンプルの 500,000 行以上停止は変わらない。自動分割・任意 KQL の自動修正はない。

## 4. portal で切り替える

1. Logic App を **Disabled** にし、Running がないことを確認する。現在の KQL、列、対象月、有効状態、公開済みの定義全体を台帳へ控える。
2. 対象パターンの `.kql` と対応する `COLUMNS` を上表から選ぶ。まず試験対象月を `MONTH_OVERRIDE` に指定する。
3. Logic App の **パラメーター**画面で `KQL_BODY` に `.kql` 本文を、`COLUMNS` に対応する配列を入力する。KQL 本文入力欄には JSON の外側の引用符や `\n` を貼らず、改行された本文を使う。
4. パラメーター画面から編集できない場合は **開発ツール → ロジック アプリ コード ビュー**で、外側の `parameters.KQL_BODY.value` と `parameters.COLUMNS.value` を変更する。JSON 文字列では改行・引用符のエスケープが必要なため、対応する `.json` の **この 2 項目だけ**を転記する。`MONTH_OVERRIDE` は試験対象月を別途指定する。

   **列の名前・数・順序が変わる場合は追加で**、デザイナーの `Export → Create_CSV_table` を開き、**列 / Columns をカスタム / Custom**にする。ヘッダーと対応する値の式を `COLUMNS` と同じ順で設定する。コードビューの場合は `definition.actions.Export.actions.Create_CSV_table.inputs.columns` を、対応する `.csv-columns.json` の配列で置き換える。他の入力や `runAfter` を消さない。たとえば操作別集計は次の配列を使う。

   ```json
   [
     {"header":"OperationNameValue","value":"@item()['OperationNameValue']"},
     {"header":"ActivityStatusValue","value":"@item()['ActivityStatusValue']"},
     {"header":"RecordCount","value":"@item()['RecordCount']"}
   ]
   ```

   顧客独自の列では `header` と `value` の列名を両方合わせる。ヘッダーだけを並べ替えると、見出しと値の対応を壊すため行わない。

5. `definition.parameters` は型・既定値の定義なので、実設定と混同しない。`LAW_RESOURCE_ID`、`STORAGE_ACCOUNT_NAME`、`$connections`、期間計算アクションは保持する。設定 JSON 全体で置き換えて実 ID をプレースホルダーへ戻したり、ワークフロー定義全体を上書きしたりしない。
6. 保存前にエディターへフォーカスし、KQL・列・対象月・接続を含む全文が意図どおりであることを確認する。貼付で旧内容が残ったり JSON が二重になったりした場合は修正し、自動保存エラーがないことを確認してから **Publish** する。公開成功通知と、再表示した値・型・カスタム列を確認する。Draft 自動保存だけで完了としない。Query の時間範囲は **Set in query** を維持する。
7. 将来の開始日時と次回予定を確認後、手動で 1 回だけ実行する。実行履歴の `QueryText` で今回公開した KQL と期間が実行されたことを確認する。[受入確認](validation.md)に従い、列、件数、CSV の保存・読み戻し、manifest / current、最終状態を記録する。有効化直後の反映待ち・再試行の注意も同手順に従う。
8. 問題があれば無効化して控えた KQL・列・対象月へ戻し、再度 Publish して確認する。ネットワーク公開・キー認証や検査削除で回避しない。
9. 合格後は本番 KQL と列を維持し、`MONTH_OVERRIDE` を **空文字**へ戻して Publish する。承認した月初業務日の次回予定を確認してから有効化する。評価のままなら無効で保持する。

実行履歴の `QueryText` 出力で、ワークフローが付加した UTC の `start` / `end` と実際の KQL を確認できます。Log Analytics のログ画面で事前確認する場合は、UTC の期間宣言を別途付けた試験用コピーを使います。試験用の宣言を `KQL_BODY` に戻さないでください。履歴・クエリには機密情報が含まれ得るため、共有先と権限に注意します。

## 5. 複数パターンの取り扱いと受入

現行は **1 ワークフローにつき有効なパターンは 1 つ、1 実行 1 CSV** です。複数パターンを毎月まとめて自動実行する機能を追加したものではありません。

同じワークフローで同月にパターンを変更して実行すると、run ごとの CSV / manifest は別に残りますが、**月の `current.json` は最後に成功したパターンの run を指します。** manifest にパターン名は記録しません。台帳にパターン名・KQL・列・対象月・run ID を対にして残し、異なるパターンを同じ月次成果物の再実行と混同しないでください。複数パターンを独立した正式成果物として毎月保存する場合は、保存先・current の分離を含めて別途設計します。

パターンを変更するたびに次を確認します。

| 確認 | 合格条件 |
|---|---|
| 月境界 | 前月開始を含み、当月開始を含まない。JST / UTC の対応が正しい |
| 抽出・集計 | 顧客 KQL の想定件数・値と一致。集計時は元件数と出力行数を区別 |
| 出力列 | `project`・`COLUMNS`・CSV のカスタム列が一致。見出しと値の対応を確認。bag のキー順が変わっても同じ列順。BOM、日本語、特殊文字も保持 |
| 0 件 | 意図した 0 行または集計行となり、CSV ヘッダーが期待どおり |
| 保存 | 読み戻し一致後に manifest / current が成功 |
| 異常系 | 存在しない列・不正 KQL を失敗扱いとし、成功成果物にしない |
| 復元 | 試験用対象月を空へ戻し、次回予定・有効状態を確認 |

0 件だけでは実データの列や抽出条件を検証できません。想定値が分かる非 0 件の対象月でも確認してください。

2026-10-25 に設定・配布生成とオフラインの応答形状テストを追加しました。**追加した AzureActivity の条件・集計を実際の Azure で実行した結果ではありません。** 導入先のデータで上表を受入確認してください。2026-10-22 の実機成功は従来のダミー設定による結果であり、追加パターンの本番動作保証へ流用しません。操作者による独立した CSV 取得は引き続き別の受入項目です。

2026-10-26 に CSV の「自動」列推定を廃止してカスタム列を明示しました。同日に Azure 実機でキー順が異なる bag の4 / 0 / 1件・再実行、`datatable` による明細4列・集計3列の保存と読み戻し、列設定不整合時の保存前停止を確認しました。[実測結果](validation.md)を参照してください。実 AzureActivity テーブルでの明細・失敗のみ・集計や顧客の本番KQLは未確認です。

## 公開情報

- [ワークフローの parameters と実行時の値](https://learn.microsoft.com/en-us/azure/logic-apps/workflow-definition-language-schema#parameters)
- [AzureActivity の列とテーブル仕様](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/tables/azureactivity)
- [KQL の summarize](https://learn.microsoft.com/en-us/kusto/query/summarize-operator?view=azure-monitor)
- [KQL の pack_all()](https://learn.microsoft.com/en-us/kusto/query/pack-all-function?view=azure-monitor)
- [CSV テーブルのカスタム列と値](https://learn.microsoft.com/en-us/azure/logic-apps/logic-apps-perform-data-operations#create-csv-table-action)
- [Monitor Logs コネクタの制限](https://learn.microsoft.com/en-us/azure/connectors/connectors-azure-monitor-logs)
- [Recurrence の設定](https://learn.microsoft.com/en-us/azure/connectors/connectors-native-recurrence)
