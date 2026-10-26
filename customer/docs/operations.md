# Consumption の運用・障害対応・後片付け

[入口](../README.md) / [導入](setup.md) / [ダミーテスト・受入確認](validation.md)

操作は Azure portal のみです。実データがない初回評価は[ダミーテスト](validation.md#2-実データ不要のダミーテスト)を使います。以下は運用設計と受入手順であり、Consumption の実機成功を保証するものではありません。

## 1. 通常の月次処理

- MONTH_OVERRIDE が空なら実行開始時点の JST 前月を処理します。開始を含み、翌月開始を含みません。
- 意図した定期実行は毎月 5 日 09:00 JST。[Recurrence の開始日時・タイムゾーン](https://learn.microsoft.com/en-us/azure/connectors/connectors-native-recurrence)と実際の次回予定を確認します。実月次発火は未観測です。
- 遅延取り込みがある場合、5 日時点で前月データが完全とは限りません。締め・再抽出・保持は顧客で決定します。
- 自動失敗通知・旧 run 自動削除は未実装です。管理者が履歴・件数・current を確認します。
- 実行履歴に本文が残り得るため、閲覧権限・保持・[Secure Inputs / Outputs](https://learn.microsoft.com/en-us/azure/logic-apps/set-up-security-permissions#secure-data-in-run-history)を本番前に確認します。

## 2. 対象月を指定して手動実行する

1. Logic App を無効化し、履歴に Running がないことを確認する。
2. 現在のパラメーター・有効状態を台帳へ控える。
3. **パラメーター / コード ビュー**で MONTH_OVERRIDE を `yyyy-MM`（例 `2026-01`）にする。COLUMNS と KQL_BODY は対で変更する。LAW_RESOURCE_ID、STORAGE_ACCOUNT_NAME、`$connections` は保持する。存在する年月を入力する。
4. 保存後に再表示して値を確認する。Standard の環境変数・ホスト再起動の操作はない。
5. 初回開始日時が将来であることを確認し、有効化する。想定外の自動実行がないか履歴を確認してから、1 回だけ手動実行する。
6. 実行 ID、対象月、UTC 窓、RowCount、最終状態を記録し、次節で保存内容を確認する。
7. 評価中は再度無効化する。通常運用へ戻す場合は元の KQL / COLUMNS と MONTH_OVERRIDE の空文字、開始日時・次回予定を確認してから有効化する。

同時実行数は 1 を維持します。履歴からの再送・別ワークフロー・接続先変更まで排他が保証されたものではありません。定期予定と重ならない作業枠で操作し、手動実行を重ねません。

## 3. CSV の取得と完了判定

```text
exports（コンテナー）
  <YYYY-MM>/
    current.json
    runs/<run-id>/
      export.csv
      manifest.json
```

保存は run ごとです。成功後に current を更新します。manifest の rowCount は JSON 数値、files は `["export.csv"]`。独自の出力契約で、Microsoft の共通仕様ではありません。

### 実行履歴での保存内容確認

1. CSV の Blob 読み戻しアクションが成功したことと、読み戻した本文が CSV 作成結果と一致したことを確認する。アップロード入力だけでは判断しない。
2. 対象月・runId・期間・RowCount と manifest / current の保存結果を確認する。
3. 読み戻しを含む実行の Succeeded と、独立した取得による current / manifest の確認は区別する。

### CSV ファイルを取得する条件

**信頼されたサービスの例外は、操作者のブラウザーを許可しません。** データ RBAC があっても、Public Disabled の Storage の CSV を通常の端末から portal で直接取得できるとは限りません。

ファイル取得が必要なら、**既存の承認済みネットワーク経路**から Blob の Private Endpoint 等へ到達できる端末と DNS を用意します。本テンプレートは取得用ネットワークを作成しません。経路がなければ、ファイル取得の受入を未達として停止し、別途設計します。Public 有効化、SAS 発行、匿名 HTTP 取得口で代替しません。

承認済み経路がある場合：

1. portal の Storage ブラウザーで **Microsoft Entra ユーザーアカウント**認証を使う。必要な管理プレーン権限と exports の Storage Blob Data Reader を管理者が付与する。
2. 対象月の current を読み、その runId と path（コンテナー基準の相対パス）を確認する。
3. **その path の** manifest と CSV を取得する。最新時刻の別 run を勝手に選ばない。
4. manifest の month / runId / UTC 窓 / rowCount / files を履歴と照合する。
5. CSV 対応ソフトで列順・論理件数・全値・BOM を確認する。改行数で件数を数えない。数式・日付の自動解釈を避ける。

バイト列・保存 MIME・Content-MD5・サイズなどは Consumption で実測して記録します。過去版のハッシュや MIME を合格値として流用しません。実行履歴の JSON を表示・保存したことを、CSV ファイルの取得成功と扱わないでください。

公式：[portal の Blob データ認証と権限](https://learn.microsoft.com/en-us/azure/storage/blobs/authorize-data-operations-portal)、[ネットワーク制限と portal のデータ操作](https://learn.microsoft.com/en-us/azure/storage/common/storage-network-security-limitations)。

### KQL パターンを変更する場合

[KQL パターンの変更](query-patterns.md)に従い、`KQL_BODY` と `COLUMNS` を差し替えます。列構成が変わる場合は `Create_CSV_table` のカスタム列も更新します。CSV は明示したカスタム列の配列順で生成し、bag のキー順には依存しません。接続と前月計算は共通です。同月に別パターンを実行すると、run 別の成果物は残りますが `current.json` は最後の成功 run を指します。台帳にパターン名・KQL・列・対象月・run ID を残してください。複数パターンの同時自動実行や、パターン別 current の分離は未実装です。

## 4. 失敗時の扱い

| 症状 | 確認・対応 |
|---|---|
| Blob の 403 | PNA Disabled / AzureServices、Consumption のシステム MI、exports の Data Contributor と反映、V1 接続の MI 認証を確認。Public 有効化・キー・ユーザー割り当て MI に変更しない |
| Monitor Logs の 401 / 403 | LAW の ARM ID、Log Analytics Reader、公開クエリ設定、管理接続の MI 認証を確認 |
| 接続作成でユーザーのサインインやキーを要求 | 誤った認証方式として停止。Logic Apps MI 対応の接続を確認 |
| Query の時間範囲エラー | Set in query と KQL の start / end を確認。無関係な相対期間で絞らない |
| KQL / SchemaMismatch / Parse JSON 失敗 | COLUMNS・project・CSV のカスタム列の一致、bag 列・必須 value 配列を確認。`Check_Header` はカスタム列と COLUMNS の列順不一致でも失敗する。自動列推定や空配列へ変更して隠さない |
| RowCap / タイムアウト / 応答超過 | 約 16 MiB、500,000 行、クエリ 100 秒 / 全体 110 秒を確認。自動分割はないため別設計 |
| CSV 読み戻し・一致確認の失敗 | 保存済みの実体・型・エンコードを確認し、成功扱いにしない |
| current 更新時の失敗 | 書き込まれた可能性があるため、current と run を再取得。前回のままと断定しない |
| portal で CSV を開けない | ネットワークとデータ権限を別々に確認。Logic App の例外を端末が使えると考えない |

クエリや CSV 保存の途中で失敗した run は正式成果物として採用しません。通常その段階では前回 current が残りますが、通信障害時の最終状態は必ず再取得で確認します。初回失敗で current が存在しないことを「0 件」と読み替えません。

再試行は定義の有限回数・固定間隔に従います。[Logic Apps の再試行と制限](https://learn.microsoft.com/en-us/azure/logic-apps/logic-apps-limits-and-config)と、[Monitor Logs コネクタ固有の制限](https://learn.microsoft.com/en-us/azure/connectors/connectors-azure-monitor-logs)は別です。自動分割・通知・本番性能を備えた基盤ではありません。

## 5. 後片付け

1. Logic App を無効化し、実行中でないことを確認する。
2. 必要な CSV と証拠を承認済み経路で保全する。取得不能ならその事実を記録し、保全前の削除は承認を得る。
3. **新規の専用 RG**に無関係な資源がないことと、削除ロック・保持ルールを確認し、RG を削除する。
4. RG 外に今回追加したロール割り当て・取得用ネットワーク設定等があれば、台帳の今回作成分だけ削除する。本一式はサブスクリプション診断設定を作らない。
5. 削除完了とサブスクリプションのリソース一覧、必要に応じ各スコープのロール割り当てを確認し、残存有無を台帳へ記録する。課金画面が即時 0 であることを完了条件にしない。

**既存 RG を使った場合は RG ごと削除しません。** 今回作成した Consumption・接続・Storage・評価用 LAW・権限だけを個別に削除します。既存プラン・旧 PoC・共有 DNS・診断設定を巻き込まないでください。失敗時もこの評価環境だけを対象にします。

提供者環境の2026-10-26検証では、当初RG削除画面のボタンが確認名入力後も無効のままでした。RG内の一覧で対象6資源のみを選択し、コマンドの「その他 → 削除」、確認文字列と最終ダイアログを経る別の正規UIでは削除できました。通知の成功6・失敗0と、検索条件なし・種類／場所すべての一覧0件を確認しました。この時点ではRG削除完了とはせず、その後、再サインイン・ブラウザー共有接続復旧後に空RGの削除を再試行しました。確認名入力の反映を待ってボタンの有効化を確認し、通常操作と最終確認を経て削除成功通知を確認。元のRG URLを再読み込みし、対象RGの404も確認したため、最終的にRGを含め削除完了としました。無効だった根本原因は未特定です。同様の場合は対象・依存関係・権限を再確認して記録し、無効ボタンの強制操作やCLI / RESTへの切り替えはしないでください。

本版は App Service プランやサイトを作成・削除しません。旧 Standard 環境の整理を、この Consumption の削除手順に含めないでください。
