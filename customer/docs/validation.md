# Consumption 受入確認・ダミーデータによるテスト

[入口](../README.md) / [導入](setup.md) / [KQLの設定・追加](query-patterns.md) / [運用・削除](operations.md)

## 1. 確認範囲と前提

同梱のダミーKQLを実際のLog Analyticsで実行し、MI管理コネクタによるCSV保存・実行内読み戻しを確認します。ログ取り込み・テーブル作成・過去ログは不要です。

| 本サンプルの確認範囲 | 導入先で行うこと |
|---|---|
| portalの3段階構築、初回からStorage Public Disabled・共有キー無効、MI接続 | [導入手順](setup.md)に従い、接続・設定・権限を確認 |
| ダミー4 / 0 / 1件、固定列順、特殊文字、再実行、列不整合時の停止 | §2を実行し、保存内容・件数・最終状態を記録 |
| 共通Storageへの複数KQL出力、用途名・対象月・JST日時付きCSV名、current・旧CSV保持 | KQLごとに試験し、相互の保存先・currentが混ざらないことを確認 |
| PerfダミーのUTC日次平均20 / 50、固定4列 | [Perfのダミー試験](query-patterns.md#32-perf-の実データがない場合の試験)で本文と列を確認 |
| 実データの抽出・集計、本番量、実月次、操作者による独立CSV取得は未確認 | 本番利用前に業務KQL・予定・取得経路を受入確認 |

**前提**：[導入手順](setup.md)の3段階を完了し、承認済み既存 LAW の ARM リソース ID、システムMI・管理接続2個・LAW / Storage の RBACが反映済みであること。StorageはPublic Disabled / Deny / AzureServices、共有キー・匿名アクセス無効を維持します。接続や保存に失敗しても、Public有効化・キー認証へ切り替えません。

## 2. 実データ不要のダミーテスト

まず同梱の3列ダミーで接続と基本動作を確認します。実行結果・確認日・実行ID・証拠・差異を台帳へ記録し、未確認項目を合格にしないでください。

### A. パラメーターを設定する

1. Logic Appを**無効化**し、概要がDisabled、履歴にRunningがないことを確認する。現在の定義・パラメーター・開始日時・有効状態を控える。
2. **パラメーター**または **開発ツール → ロジック アプリ コード ビュー**で次を設定する。接続参照 `$connections` は保持する。

   | 名前 | 値 |
   |---|---|
   | LAW_RESOURCE_ID | 導入時のLAWのARMリソースID |
   | STORAGE_ACCOUNT_NAME | 導入時の保存用Storage名 |
   | MONTH_OVERRIDE | `2026-01` |
   | COLUMNS | **配列** `["TimeGenerated","Id","Text"]` |
   | KQL_BODY | 下記全文。[sample.kql](../settings/sample.kql)と同じ |

   `Export → Create_CSV_table` のカスタム列も [sample.csv-columns.json](../settings/sample.csv-columns.json)の順・値の式に合わせます。初回ARMでは入力columnsから生成済みですが、別の列設定から戻す場合は変更が必要です。

   KQL入力欄には次の本文を貼り付けます。`start` / `end` はワークフローが付加するため宣言しません。

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

3. コードビューでは外側の `parameters.<名前>.value` を編集する。型定義の `definition.parameters` と混同しない。JSON文字列は[sample.json](../settings/sample.json)の対象項目を参考にし、設定全体で接続先を上書きしない。
4. KQL・列・カスタム列・対象月・接続を確認して**Publish**する。公開成功通知と再表示した値を確認し、Draftの自動保存だけで完了としない。試験直前までDisabledを維持する。
5. Queryの時間範囲が **Set in query**、Recurrenceが承認済みの将来日時・**Tokyo Standard Time**、同時実行数が1であることを確認する。

### B. 月次を待たずに手動実行する

1. Logic Appを有効化する。想定外の自動実行やRunningがないことを履歴で確認する。
2. 概要の **実行 / トリガーの実行**から1回だけ実行する。英語画面では **Run → Run**。公開済みのワークフローを使い、**Run draft**は使わない。
3. **Refresh**で履歴を更新し、新しい実行IDと最終状態を確認する。受付通知だけで完了とせず、Running中に重ねて実行しない。
4. `Export → QueryText` の実際のKQL・期間、RowCount、CSV保存・読み戻し、manifest / currentのアクションを確認する。

   | 項目 | 期待値 |
   |---|---|
   | Month | `2026-01` |
   | StartUtc / EndUtc | `2025-12-31T15:00:00` 以上、`2026-01-31T15:00:00` 未満 |
   | RowCount | JSON数値の `4` |
   | CSV保存・読み戻し | 成功し、本文がCSV作成結果と一致 |
   | manifest / current | 対象月・workflowName・runId・実CSV名・相対パスが一致 |
   | 最終状態 | Succeeded |

5. 評価中は再度無効化する。失敗時はエラーと差異を記録し、[障害対応](operations.md#4-失敗時の扱い)へ進む。

有効化直後はトリガーの反映待ちでDisabledのHTTP 400になる場合があります。明確な受付失敗と新runがないことを確認できた場合だけ、反映を待ってRefresh後に再試行します。受付済み・結果不明の要求を無条件に再送しません。

### C. 保存済みCSVを確認する

実行詳細のアクション検索から **Read Back CSV**、**Manifest**、**Upload Current**を開きます。`Read_Back_CSV` のBodyは `$content-type` とbase64の `$content` を含むバイナリ本文です。読み込み完了後の実データを確認し、未読込の `{}` やアップロード入力だけで判定しません。未加工出力の署名付きURL・応答ヘッダーは共有ログへ転載しません。

| Id | TimeGenerated（UTC） | Text |
|---|---|---|
| 2 | `2025-12-31T15:00:00Z` | `start boundary` |
| 3 | `2026-01-15T03:04:05Z` | `comma, quote " and 日本語` |
| 4 | `2026-01-20T00:00:00Z` | `line1` と `line2` の間に実際の改行 |
| 5 | `2026-01-31T14:59:59Z` | `end boundary last` |

列は **TimeGenerated,Id,Textの順**です。Id=1・6を含まず、各Idと値が表に一致することを確認します。日時は小数部を含むUTC表記となる場合があります。行順は保証しないため、Idで照合します。

UTF-8 BOM、日本語、カンマ、二重引用符、埋め込み改行を確認します。値中に改行があるため、改行数を件数にしません。BOMなど画面だけで判断できない項目は未確認と記録します。

CSV名は `<workflowName>_2026-01_<開始日時yyyyMMdd-HHmmss>-JST.csv` です。manifest.startedAtUtcをJSTへ換算し、実CSV名・manifest.files・current.csvFileNameを照合します。current.pathは対象ワークフロー・月の実行フォルダーを指します。

**操作者によるファイル取得は別の確認です。** [承認済み経路](operations.md#3-csv-の取得と完了判定)から保存済みcurrent → そのpathのmanifest → CSVを取得し、本文・列・件数を照合します。経路がなければ未実施と記録します。実行履歴の本文表示をダウンロード成功と扱わず、取得後も数式や日付の自動解釈を避けてCSVを開いてください。

### D. 0件・翌月境界・再実行

毎回、無効化 → Runningなし → MONTH_OVERRIDEの変更・Publish → 有効化・1回実行 → 内容確認 → 無効化の順で行います。KQL・COLUMNS・カスタム列は変えません。

| MONTH_OVERRIDE | UTC窓（開始以上・終了未満） | 期待値 |
|---|---|---|
| `2025-11` | `2025-10-31T15:00:00` ～ `2025-11-30T15:00:00` | 0件。BOM＋固定3列ヘッダー＋CRLFのみ |
| `2026-02` | `2026-01-31T15:00:00` ～ `2026-02-28T15:00:00` | 1件。Id=6、Textは `next month first` |
| `2026-01` の再実行 | 1月の窓 | 新しい実行フォルダー・CSV、current更新。以前のCSV / manifestは保持 |

再実行の前後で保存済みcurrentと旧runを[承認済み経路](operations.md#3-csv-の取得と完了判定)から確認します。複数KQLでは、他ワークフローの同月currentが変わらないことも照合します。取得できない項目を、書き込み応答だけで合格にしません。

0件は正常応答の `value: []` の場合だけです。本文欠損・必須bag欠損・Parse JSONエラー・PartialErrorを0件に読み替えません。

### E. 異常系と終了

成功時の設定とcurrentを控え、**1ケースずつA・Bと同じ公開・実行手順**で試験します。各ケースの後は無効化し、変更箇所を復元します。

| 変更 | 期待値・復元 |
|---|---|
| COLUMNSを `["WrongColumn"]` に変更 | Failed、Upload CurrentがSkipped。COLUMNSを元へ戻す |
| COLUMNSは元のまま、CSVカスタム列の並びだけ逆順にする | Failed / SchemaMismatch、Upload CSV / Upload CurrentがSkipped。カスタム列を元へ戻す |
| KQL_BODYを `This is not valid KQL` に変更 | QueryでFailed、Upload CurrentがSkipped。正しいダミーKQLへ戻す |

各失敗後に保存済みcurrentが直前成功のままであることを承認済み経路から確認します。**current更新そのものの通信障害では、書き込み済みの可能性もあるため、保存実体を再取得して判断**します。

終了時は正しいダミー設定・列へ戻してPublishし、Disabled・Runningなしを確認します。保持するか[削除するか](operations.md#5-後片付け)を記録します。MONTH_OVERRIDEを空にするだけで本番運用を始めません。

## 3. 受入確認表

導入先の結果を記入する表です。結果欄は「合格 / 不合格 / 未実施」とし、確認日・実行ID・証拠・差異を添えてください。

| 項目 | 合格条件 | 結果・証拠 |
|---|---|---|
| 配置・権限 | 専用RG、共通Storage / LAW、KQLごとにConsumption 1・接続2・システムMIと限定ロール | 未記入 |
| ネットワーク・認証 | 初回からPublic Disabled / Deny / AzureServices、共有キー・匿名無効。MIで実接続 | 未記入 |
| 公開設定 | KQL・列・カスタム列・対象月・接続・開始日時が公開済み定義と一致 | 未記入 |
| ダミー4 / 0 / 1件 | 期間・全値・固定列順・BOM・特殊文字と数値rowCountが一致 | 未記入 |
| 命名・参照 | workflowName・対象月・開始時刻JSTを含む実CSVをmanifest / currentが参照 | 未記入 |
| 再実行・KQL間分離 | 自current更新、旧CSV / manifest保持、他KQLのcurrent不変 | 未記入 |
| 異常系 | 列不整合・不正KQLでFailed、正式成果物に採用せず、保存済みcurrentを確認 | 未記入 |
| 業務KQL | 実データの非0件・0件、抽出・集計値・日境界が業務要件に一致 | 未記入 |
| 独立CSV取得 | 承認済み経路とEntra権限でcurrent → manifest → CSVを取得・照合 | 未記入 |
| 月次・排他 | JSTの初回・次回予定と同時実行1を確認。初回月次結果は運用開始後に記録 | 未記入 |
| 障害・容量 | 権限不足・通信障害の検知と復旧、上限内の件数・サイズ・実行時間を確認 | 未記入 |
| 保持・削除 | データと履歴の保持、共有基盤の保護、承認範囲だけの削除と残存確認 | 未記入 |

## 4. 本番化前の条件

業務KQL・固定列、実テーブルと権限、月次件数・サイズ、クエリ実行時間、遅延取り込み・再抽出、保存・履歴の保持、監視通知、機密性、取得経路を承認します。

Monitor Logsの上限は約16 MiB / 500,000行 / クエリ100秒・コネクタ110秒です。本サンプルは500,000行以上を停止し、自動分割・自動失敗通知は行いません。必要な運用設計と開始前の受入・承認を完了し、本番KQL・空のMONTH_OVERRIDE・次回予定を確認して有効化します。初回月次の実行結果は運用開始後の確認項目として管理します。

## 公開情報

- [datatable](https://learn.microsoft.com/en-us/kusto/query/datatable-operator?view=azure-monitor)
- [Monitor Logsの制限](https://learn.microsoft.com/en-us/azure/connectors/connectors-azure-monitor-logs)
- [QueryDataV2](https://learn.microsoft.com/en-us/connectors/azuremonitorlogs/)
- [APIの部分応答](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/api/response-format)
- [Logic Appsの制限・再試行・同時実行](https://learn.microsoft.com/en-us/azure/logic-apps/logic-apps-limits-and-config)
- [実行履歴のSecure Inputs / Outputs](https://learn.microsoft.com/en-us/azure/logic-apps/set-up-security-permissions#secure-data-in-run-history)
- [Log Analyticsの保持](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/data-retention-configure)
