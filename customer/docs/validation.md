# Consumption 受入確認・ダミーデータによるテスト

[入口](../README.md) / [導入](setup.md) / [運用・削除](operations.md)

## 1. 検証状態と最優先ゲート

| 証拠 | 現在の扱い |
|---|---|
| Consumption の配布資材の静的テスト | JSON / ARM / 接続・設定・出力契約・リンクを検査。Azure での実行を証明しない |
| 旧 Standard / WS1 の保存・独立読み戻し | 過去版の結果。Consumption の実績として流用しない |
| Consumption の ARM 実投入・接続・CSV 保存と読み戻し | **未実施** |
| portal だけの構築・編集・実行・CSV ファイル取得・削除 | **未実施** |
| 初回から Public Disabled＋信頼されたサービス例外の接続 | **未実施。最優先の停止ゲート** |

実行時は顧客管理下のコピーに結果・確認日・実行 ID・証拠・差異を記入します。未実施の項目を合格にしません。

**前提**：[導入手順](setup.md)の 3 段階を完了し、Consumption のシステム MI・管理接続 2 個・RBAC が反映済みであること。Public network access Disabled、Shared Key 無効、匿名無効、AzureServices 例外を維持すること。保存に失敗しても、キーや Public 有効化へ切り替えません。

## 2. 実データ不要のダミーテスト

`datatable` がその場で 6 件を生成します。ログ取り込み・テーブル作成・診断設定・過去ログは不要です。実際の LAW と Blob を使うため、オフラインの模擬試験ではありません。

### A. パラメーターを設定する

1. Logic App を**無効化**し、実行履歴に Running がないことを確認する。現在のパラメーター・開始日時・有効状態を台帳に控える。
2. **パラメーター**または **コード ビュー**で次を設定する。Standard の環境変数・アプリ設定は使わない。接続参照 `$connections` は保持する。

   | 名前 | 値 |
   |---|---|
   | LAW_RESOURCE_ID | 導入時の LAW の ARM リソース ID |
   | STORAGE_ACCOUNT_NAME | 導入時の保存用 Storage 名 |
   | MONTH_OVERRIDE | `2026-01` |
   | COLUMNS | **配列** `["TimeGenerated","Id","Text"]`。文字列へ変換しない |
   | KQL_BODY | 下記全文。[sample.json](../settings/sample.json)の KQL と同じ |

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

3. 保存し、再度開いて値を確認する。配布 JSON の内部プロパティを手入力する際は、型や `$connections` を壊さない。
4. Query の時間範囲が **Set in query**、Recurrence が将来日時で **Tokyo Standard Time**、同時実行数が 1 と確認する。

### B. 月次を待たずに手動実行する

1. Logic App を有効化する。有効化時の想定外の実行がないか確認し、Running があれば待つ。
2. **実行 / トリガーの実行**から 1 回だけ実行する。毎月 5 日を待つ必要はない。実行できなければ停止し、CLI に切り替えない。
3. 実行履歴で新しい実行 ID と最終状態を確認する。Running 中に再実行しない。
4. Export の期間・件数・CSV 保存・読み戻し・manifest / current のアクションを開く。

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

各項目に「結果・確認日・証拠・差異」を追記してください。現時点の実機結果はすべて未実施です。

| 項目 | 合格条件 | 初期状態 |
|---|---|---|
| 初回ネットワーク設定 | 初回から PNA Disabled / Deny / AzureServices。共有キー・匿名無効 | 未実施 |
| 最小構成 | Consumption 1、Storage 1、接続 2、LAW 1。実行用 VNet / PE / DNS / ホストなし | 未実施 |
| MI 認証 | システム MI と exports / LAW の限定ロール。ユーザーログイン・キーなし | 未実施 |
| portal の構築・保存 | 3 段階投入、定義・値・接続の表示と再保存が成功 | 未実施 |
| ダミーの保存と読み戻し | 4 / 0 / 1 件、全値・BOM・列順・JSON 型・対象期間が一致 | 未実施 |
| 同月再実行 | 新しい run と current、旧 run 保持。重複実行をしない | 未実施 |
| 異常応答・権限不足 | 明示的 Failed、有限リトライ、未完了成果物を採用しない | 未実施 |
| 通常の公開クライアント拒否 | 有効な Entra データ権限があってもネットワークで拒否。認証不足の 403 と区別 | 未実施 |
| 独立取得・CSV ファイル取得 | 承認済み経路で current → manifest → CSV を取得・照合 | 未実施 |
| 定期発火・排他 | 初回・次回予定、同時実行数 1。短周期と実月次観測を区別 | 未実施 |
| 削除 | 専用環境だけを削除し、RG 外も残存なし | 未実施 |

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
