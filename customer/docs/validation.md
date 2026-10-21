# 受入確認表と本番化前の条件

[入口](../README.md) / [導入](setup.md) / [運用・削除](operations.md)

## 1. 証拠の区分

| 区分 | 確認した内容 | 本サンプルでの扱い |
|---|---|---|
| 過去の ASE / WS1 PoC | キーなし起動・実行・再起動、固定サンプル、0 件、実ログの件数比較、不正 KQL / 列不一致、外部遮断、VM 内からの取得 | CLI / 管理 API / VM の検証実績。portal 完結の実証ではない |
| 配布資材の静的確認 | ARM 生成、JSON 構文、設定・出力・リンク整合、識別子混入確認 | Azure への投入成功・サポートの証明ではない |
| 単一 Storage・コネクタ版の実機確認（2026-10-21） | 既存 WS1 を再利用し、3 段階 ARM の validate / what-if / 実投入。Storage 1 個・PE 4 個・DNS 4 ゾーン・サブネット 2 個。実際の保存済み Blob を組み込み readBlob で独立読み戻し、1 月 4 件・0 件月・2 月 1 件を照合。不正 KQL / 列不一致で Failed と current 不変を確認。同月再実行と旧 run 保持、再起動後の JSON 保持・本体再配置なしの実行と読み戻しも成功 | 提供者の CLI / 管理 API と検証用ワークフローによる実績。Storage / サイトの公開化・キー利用・検証用 VM は不要だった。portal からの取得の実証ではない |
| 今回の portal 実機受入 | 同梱資材での新規構築、編集保存、手動実行、取得、再起動、削除 | **未実施**。サポート・構成・費用・作成権限の承認後に実施する |

すべての portal 受入項目は現在 **未実施**です。実行時に顧客管理下のコピーへ「結果・確認日・証拠参照・差異」を記入してください。サポート確認と個別の作成承認がないまま評価リソースを作成しません。

保存済み CSV の検証値は次のとおりです。current が指す run の manifest / CSV を別の確認ワークフローで取得し、実行履歴のアップロード入力だけでは判定していません。

| 対象月 | 論理データ件数 | 保存サイズ | SHA-256 |
|---|---:|---:|---|
| `2026-01` | 4 | 233 bytes | `63d0f75b814db2df09bab7992bbcbb8833f5f517fc35e3654a4ab43bddc1d3a6` |
| `2025-11` | 0 | 26 bytes | `2530c301ce1cfd79368bbcca96660ba539234c2e51dafd4e05846386a7f8b3b4` |
| `2026-02` | 1 | 75 bytes | `1386801db0e5e71a7e18e9660da407a203d38793a0ebb897430b30935f953cf3` |

全件で UTF-8 BOM、列順、CSV パーサーでの件数・各値、Storage の Content-MD5 と実バイトの一致、manifest の数値 rowCount・対象月・UTC 窓・runId・files、current の runId / path を確認しました。組み込み uploadBlob の保存 MIME は CSV / JSON とも `text/plain; charset=utf-8` でした。本文の形式・拡張子とは区別し、[運用手順](operations.md)の差異を確認してください。

検証用の追加資源・権限は削除済みです。ただし後片付けで最後のアプリと既存の空 WS1 プランが連動削除され、元の宣言を再投入して同名・同リージョン・WS1 の空プランへ復旧しました。既存プランを無変更で保持できたという実績ではありません。[削除手順](operations.md)には、関連プランの保持を明示できない場合は停止する条件を追加しています。

## 2. 固定サンプルの期待値

[sample.json](../settings/sample.json) の KQL は datatable を LAW API で実行します。実際の取り込み済みログを読むテストではありません。新規 LAW に過去月のデータは不要です。

| MONTH_OVERRIDE | UTC 範囲（開始以上・終了未満） | 期待行数 / Id |
|---|---|---|
| `2026-01` | `2025-12-31T15:00:00` ～ `2026-01-31T15:00:00` | 4 件、Id=2,3,4,5 |
| `2025-11` | `2025-10-31T15:00:00` ～ `2025-11-30T15:00:00` | 0 件、ヘッダーのみ |
| `2026-02` | `2026-01-31T15:00:00` ～ `2026-02-28T15:00:00` | 1 件、Id=6 |

1 月の CSV ヘッダーは `TimeGenerated,Id,Text`。Id=3 の Text はカンマ・引用符・日本語、Id=4 は値の途中の改行を含みます。CSV 対応ソフトで読み戻した値が元の datatable と一致することを確認します。CSV テキストの行数だけで数えません。BOM は UTF-8 インポートでの認識も確認し、バイト単位の証拠が必要なら組織で承認されたブラウザー操作可能な確認手段を事前に定めます。見た目だけでバイト列を実証したと記録しません。

### 2.1 ダミーデータでのテスト実行手順

**実データがない場合は、ここからテストしてください。** クエリ内の `datatable` が 6 件のダミーデータをその場で生成するため、LAW へのログ取り込み、テーブル作成、AzureActivity の診断設定は不要です。古い日付は境界テスト用の固定値なので、実行日に合わせて変更しません。LAW の保持期間外の日付でも、保存済みログを参照せずに生成します。

ただしオフラインの模擬実行ではありません。実際の LAW を Monitor Logs 管理コネクタと MI で問い合わせ、実際の非公開 Blob に組み込みコネクタで出力します。**ログが空でも、LAW・Logic App・Storage・接続・権限・ネットワークは必要**です。[導入手順](setup.md)の承認、全 8 アプリ設定、接続 JSON、Query の時間範囲選択、ワークフロー保存を完了してから、閉域端末内のブラウザーで操作します。サポート確認待ちはこの手順追加では解除しません。

#### A. テスト用設定を入れる

1. portal で対象 Logic App → **ワークフロー → monthly-export** を開き、無効化する。実行履歴に Running がないことを確認する。
2. 現在の設定値と有効状態を顧客台帳へ控える。Logic App → **設定 → 環境変数**（画面によっては構成）を開き、次の 5 項目を追加・更新する。構築時に設定した MONITOR_* の 3 項目と既存のホスト設定は保持する。

   | 設定名 | テスト時の値 |
   |---|---|
   | LAW_RESOURCE_ID | 構築した LAW の ARM リソース ID。基盤デプロイ出力の `lawResourceId`。GUID ではない |
   | OUT_BLOB_URI | 基盤デプロイ出力の `outBlobUri`。末尾スラッシュや `exports` は付けない |
   | MONTH_OVERRIDE | `2026-01`。空にすると実行日時の前月になり、期待する 4 件にならない |
   | COLUMNS | `TimeGenerated,Id,Text` |
   | KQL_BODY | 下記の KQL 全体（[sample.json](../settings/sample.json) の KQL_BODY と同じ内容） |

   KQL_BODY の入力欄には、**JSON 全体や外側の引用符ではなく、次の KQL をそのまま**貼り付けます。JSON 内の `\"` / `\\n` を目視でコピーする必要はありません。`start` / `end` の宣言はワークフローが付けるため、ここへ追加しません。

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

3. **適用**して再起動が終わるまで待つ。再度設定を開き、5 項目が保存されたことを確認する。ServiceUnavailable が続く場合は停止し、[障害対応](operations.md)を参照する。
4. 接続 `AzureBlob` / `azuremonitorlogs` が保存済みで、Query の Time Range Type が「Set in query / クエリで設定」（配布値 `"3"`）であることを確認する。

#### B. 月次を待たずに 1 回実行する

1. `monthly-export` を開き、[導入手順](setup.md)で設定した初回開始日時が将来であることと、有効化に伴う想定外の実行がないことを確認する。
2. ワークフローを有効化し、**実行 / トリガーの実行**から 1 回だけ手動実行する。毎月 5 日まで待つ必要はない。操作ができなければ停止し、CLI や公開化で代替しない。
3. **実行履歴**を更新し、新しい実行を開く。実行 ID と最終状態を控える。Running の間は再実行しない。
4. **Succeeded** になったら、実行内の Export の各アクションを開いて以下を確認する。

   | アクション | 期待値 |
   |---|---|
   | Month | `2026-01` |
   | StartUtc | `2025-12-31T15:00:00` |
   | EndUtc | `2026-01-31T15:00:00` |
   | RowCount | `4` |
   | Upload_CSV / Upload_Manifest / Upload_Current | すべて Succeeded |

5. ワークフローを再び無効化する。Failed の場合は成功扱いにせず、失敗アクションを記録して[障害対応](operations.md)を確認する。

#### C. Blob の出力を確認する

1. 同じ閉域端末の portal で、出力 Storage → **ストレージ ブラウザー → BLOB コンテナー → exports → 2026-01** を開く。Microsoft Entra ユーザーアカウントで認証する。
2. `current.json` を読み、`runId` が B の実行 ID と一致することを確認する。`path` が示す `2026-01/runs/<run-id>/` の `manifest.json` と `export.csv` を開く、または承認済みの方法で取得する。
3. manifest の month が `2026-01`、rowCount が数値の `4`、runId と UTC 範囲が B と一致することを確認する。
4. CSV のヘッダーが `TimeGenerated,Id,Text`、データが次の 4 件であることを確認する。行順ではなく Id と値の組で照合する。Id=1 と Id=6 は含まれない。

   | Id | TimeGenerated（UTC。表示形式は同じ時刻なら可） | Text |
   |---|---|---|
   | 2 | `2025-12-31T15:00:00Z` | `start boundary` |
   | 3 | `2026-01-15T03:04:05Z` | `comma, quote " and 日本語` |
   | 4 | `2026-01-20T00:00:00Z` | `line1` と `line2` の間に実際の改行 |
   | 5 | `2026-01-31T14:59:59Z` | `end boundary last` |

CSV のカンマ・引用符・改行は CSV としてエスケープされます。値に改行があるため、ファイルの見た目の行数は 4 行とは限りません。取得や確認の詳細は[CSV の取得と完了判定](operations.md#3-csv-の取得と完了判定)を参照してください。

#### D. 0 件と翌月境界も確認する

KQL_BODY と COLUMNS は変更せず、A～C の手順で **MONTH_OVERRIDE だけ**を変えて順に実行します。毎回、無効化・実行中なしの確認 → 設定適用・起動待ち → 有効化・手動実行 → 履歴・出力確認 → 無効化の順を守ります。

| MONTH_OVERRIDE | 確認するコンテナー内の current | 期待結果 |
|---|---|---|
| `2025-11` | `2025-11/current.json` | Succeeded、manifest 0 件、CSV はヘッダーのみ |
| `2026-02` | `2026-02/current.json` | Succeeded、manifest 1 件、Id=6 / `next month first` のみ |

0 件試験でも Query が正常に `tables` / `rows` を返していることを実行履歴で確認します。本文なしや予期しない応答を 0 件成功と読み替えません。

#### E. テストを終える

- 実データがない評価環境では、**ワークフローを無効化したまま**終了する。MONTH_OVERRIDE は `2026-01`、KQL_BODY / COLUMNS は上のダミー設定へ戻して適用し、起動後も無効であることを確認する。空文字にして定期運転を始めない。
- 元から別の用途で利用していた場合は、控えた設定を復元し、再有効化はその運用の承認に従う。
- 対象月・実行 ID・結果・manifest 件数・CSV の確認結果を記録する。この試験はクエリ経路と CSV 出力の確認であり、実ログ取り込みや実月次発火の確認ではない。
- この評価が終わったら[後片付け](operations.md#5-評価環境の後片付け)を実施する。

## 3. portal 実機受入項目

### 保存済み Blob の独立した読み戻し（実機検証時）

アップロードアクションの入力・Succeeded だけを保存の証拠にしません。§2.1 C のストレージブラウザーで読み戻すか、検証用ワークフローに **Azure Blob Storage の組み込み「Read blob content」**を追加して実際に取得します。後者は VNet 内の既存実行基盤を使うため、追加 VM、キー、Storage の公開化やポリシー除外タグは不要です。以下は実施予定の確認であり、この版の実績ではありません。

1. デザイナーで確認専用の Stateful ワークフローを作り、初回開始を将来に設定してテスト時だけ手動実行する。接続は既存の組み込み `AzureBlob` / システム MI を使う。管理版 Blob コネクタへ切り替えない。
2. Container name=`exports`、Blob name=`2026-01/current.json` を `Read blob content` で読む。保存済み本文の runId / path を取り出す。
3. 取得した path に `manifest.json` と `export.csv` を足した Blob を、別の `Read blob content` アクションで読む。アップロード入力を参照する Compose で代用しない。
4. 読み戻した current・manifest・CSV の実行 ID、対象月、UTC 範囲、4 件の Id と値、ヘッダーを照合する。CSV は UTF-8 BOM と特殊文字も確認する。バイナリの `$content` 形式なら承認済み手段で Base64 をデコードし、CSV パーサーで件数を確認する。見た目の行数やアップロード本文だけでは合格にしない。
5. 0 件月・翌月境界・同月再実行も同じ方法で読む。不正 KQL / 列不一致の失敗後、保存済み current が直前の成功 run のままであることを再取得して確認する。
6. 証拠を顧客台帳へ保存してから、確認専用ワークフローを無効化・削除する。本番フローへ検証アクションを残さない。

| ID | 操作・確認 | 合格条件 / 停止条件 | 現在 |
|---|---|---|---|
| G1 | WS1 サポート回答と要件照合 | キー禁止・非公開・コンテンツ共有なし・portal 編集・永続化を含む当該構成を認める回答。未確認なら停止 | 未確認 |
| G2 | 構成・費用・権限・削除範囲を承認 | 専用 RG と管理経路を含め承認済み。見積もりと構成が一致 | 未承認 |
| P1 | 3 段階の同梱 ARM を portal 投入 | 全デプロイ成功、出力から次の入力を転記できる。コマンド不要 | 未実施 |
| P2 | PNA / Shared Key / MI / RBAC | Storage 1 個の PNA / Shared Key / 匿名アクセス無効、LAW 公開クエリ有効・公開取り込み無効、アプリ PNA 無効。アプリ MI の Blob 権限は exports のみ。Files の共有 / 接続文字列なし | 未実施 |
| P3 | PE / DNS / 管理端末 | PE 4 個承認済み、DNS 4 ゾーンと VNet リンク、閉域管理経路が揃い、Blob 閲覧・アプリ編集が可能。Monitor Logs 管理コネクタへ HTTPS / MI で接続可能。Queue / Table は保持、File / AMPLS / Monitor DNS と未使用 PoC サブネットなし | 未実施 |
| P4 | portal で接続・Stateful 作成・保存 | 2 接続の JSON、Query の時間範囲選択、トリガー同時実行数 1 を保存し、再読込後も保持。host ファイルの CLI 配置を求められたら停止 | 未実施 |
| P5 | 固定サンプル 1 月を手動実行 | Succeeded、manifest 4 件、Id 集合・列順・特殊文字・JST 境界が一致 | 未実施 |
| P6 | 0 件月と 2 月を手動実行 | 0 件はヘッダーのみ、2 月は Id=6 の 1 件。無応答を 0 件と誤認しない | 未実施 |
| P7 | 1 月を順に 2 回実行 | 異なる runId、current は最後の成功 run、旧 run は保持、途中成果物の混在なし | 未実施 |
| P8 | COLUMNS を `WrongColumn` にして 1 月実行 | Failed、直前の 1 月 current が不変。試験後 COLUMNS 復元 | 未実施 |
| P9 | KQL_BODY を `this_is_not_valid_kql` にして実行 | Failed、直前の current 不変。試験後 KQL / 設定復元 | 未実施 |
| P10 | 定義を portal で編集保存、アプリ設定変更・再起動 | File PE なしの新規構成で、再読込後も定義・変更内容が保持され、再実行成功。成功後に変更を戻す | 未実施 |
| P11 | 閉域 / 外部の対比 | Storage / サイトは閉域ブラウザーでアクセス可能、外部は拒否。匿名 403 だけで判断しない。LAW は閉域対象外のため、正規権限で公開クエリできることを許容 | 未実施 |
| P12 | 将来の初回日時・タイムゾーン・予定と初回挙動 | 意図しない即時発火がなく、初回・次回予定が設定意図と整合。実発火は別途観測 | 未実施 |
| P13 | 月次の実際の自動発火 | 毎月 5 日 09:00 JST、前月範囲で実行成功。手動実行や短周期試験で代用しない | 未実施 |
| P14 | 後片付け | 専用 RG と RG 外の今回追加物を削除し、残存なしを portal で確認。既存 RG / プラン再利用時は今回作成物だけを削除し、既存プランの保持を直接確認。保持を明示できなければ停止 | 未実施 |

P11 の Blob は外部端末の Entra ID 認証によるストレージブラウザーで拒否を確認します。LAW は公開クエリを許可するため外部拒否を合格条件にせず、MI / RBAC と HTTPS 送信を確認します。社内規程で外部試験ができない場合は未実施と記載します。アプリの外部拒否は通常のサイト URL の表示結果だけで業務 API の認証・閉域性をすべて証明したと扱いません。

## 4. 任意：取り込み済み実ログの確認

**実データがない場合は本節をスキップしてください。** ダミーデータのテストは §2.1 だけで実施でき、診断設定による取り込みは必要ありません。

1. 診断設定による AzureActivity の送信を許可する承認と、サブスクリプションの診断設定権限を先に得る。これは Microsoft の非公開サービス間チャネルによる取り込みであり、LAW 公開クエリの経路とは別。AMPLS は本構成では使用しない。
2. サブスクリプションの診断設定で、今回専用の識別可能な設定を追加し、評価 LAW を送信先にする。既存設定を上書きしない。
3. 評価 RG のリソース操作を行い、閉域端末の LAW のログ画面で到着を確認する。公開取り込みを有効にしない。
4. [azureactivity.json](../settings/azureactivity.json) の KQL / COLUMNS を使い、MONTH_OVERRIDE はログが存在する月にする。固定サンプルの検証月をそのまま使わない。
5. KQL の `start` / `end` と同じ UTC 条件でログ画面から count を取得し、CSV の件数・識別可能なレコードを比較する。ログ画面では `let start=datetime(...); let end=datetime(...);` を同じ範囲で指定する。時間範囲 UI がさらに絞り込まないよう確認する。
6. 取り込み中の件数は変化する。固定対象の識別子などで範囲を絞り、差がある場合は成功と扱わない。固定サンプルと実ログの結果を分ける。
7. 後片付け時は RG 外の診断設定も削除する。

## 5. サンプルの範囲外・本番化前のゲート

- **本番規模**：対象テーブル、プラン、月次件数・サイズ、クエリ時間、遅延取り込み、保持期限。管理コネクタは最大 500,000 行、応答約 16 MiB、クエリ最大 100 秒 / コネクタ最大 110 秒。HTTP 版の約 64 MB / 最大 10 分をこの版の上限として使わない。単一 CSV の安全な範囲を実測する。
- **大容量分割**：未実装。RowCap の閾値到達を検出して止めることと、全量を分割出力できることは違う。
- **部分応答・スキーマ**：管理コネクタ本文の error / PartialError は失敗。必須 value 配列と bag 列を Parse JSON で検証し、欠損や無応答は空結果に変換しない。正常応答は実機確認済みだが、PartialError 実発生・不正応答の実機試験は未実施。
- **同時実行**：トリガー同時実行数 1 を設定。履歴からの再送・別ワークフローを含む排他や、待ちキュー・アプリ再起動中の挙動は別途試験する。運用では実行を重ねない。
- **定期発火**：初回読み込み時の発火が過去 PoC で疑われた。開始日時、停止復帰、実月次発火を確認する。
- **運用監視・機密性**：通知先、Action Group 等、実行履歴保持、Secure Inputs / Outputs、最小権限、ログ本文の扱いを決める。
- **保管**：CSV の保持・旧 run / 失敗 run の処理、バージョニング・イミュータブル要否、持ち出し経路を承認する。未承認の自動削除を設定しない。
- **WS1 の長期安定**：コンテンツ永続化、プラットフォーム更新、スケール、サポート回答を確認する。今回の短期動作確認だけで保証しない。

受入結果に未実施・不合格が残れば「portal 完結検証済み」「本番対応済み」と表示しません。

## 公式の制約確認

- [datatable：クエリ内でスキーマと値を定義](https://learn.microsoft.com/en-us/kusto/query/datatable-operator?view=azure-monitor)
- [Query API 応答と PartialError](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/api/response-format)
- [Azure Monitor のサービス制限](https://learn.microsoft.com/en-us/azure/azure-monitor/fundamentals/service-limits#query-api)
- [Monitor Logs 管理コネクタ固有の応答サイズ・件数・タイムアウト・非対応テーブルプラン](https://learn.microsoft.com/en-us/azure/connectors/connectors-azure-monitor-logs)
- [Monitor Logs の QueryDataV2 操作と認証方式](https://learn.microsoft.com/en-us/connectors/azuremonitorlogs/)
- [Logic Apps の制限](https://learn.microsoft.com/en-us/azure/logic-apps/logic-apps-limits-and-config)
- [Log Analytics の保持](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/data-retention-configure)
- [Recurrence の初回実行・開始日時・タイムゾーン](https://learn.microsoft.com/en-us/azure/connectors/connectors-native-recurrence)
- [実行履歴の Secure Inputs / Outputs](https://learn.microsoft.com/en-us/azure/logic-apps/set-up-security-permissions#secure-data-in-run-history)

上記は公開仕様の参照先です。§1 の CSV ハッシュ・保存 MIME・再起動後の結果や、時間範囲の内部値は本サンプルの実機確認であり、公開仕様による保証ではありません。
