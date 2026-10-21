# 運用・障害対応・後片付け

[入口](../README.md) / [導入](setup.md) / [受入確認](validation.md)

すべて閉域接続できる端末内のブラウザーと Azure portal で操作します。ローカルコマンドや Cloud Shell は使いません。

**実データなしで初めて試す場合は、[受入確認](validation.md) §2.1 のダミーデータによるテスト実行手順を使ってください。** ログ取り込み不要で、設定する KQL と操作・期待結果を一続きで確認できます。評価終了時は無効化し、通常運用へ自動的に移行しません。

## 1. 通常の月次処理

- MONTH_OVERRIDE が空なら、実行開始時点の JST 前月を処理します。期間は **開始を含み、翌月開始を含まない**条件です。
- 意図した定期実行は毎月 5 日 09:00 JST。[Recurrence の開始日時・タイムゾーンの仕様](https://learn.microsoft.com/en-us/azure/connectors/connectors-native-recurrence)に従い、設定変更後に初回実行・次回予定を確認し、実際の月次発火未観測と区別します。
- データ遅延で 5 日時点の前月ログが完全になるとは保証しません。締め日、再抽出、保持期間は顧客で決定します。
- このサンプルに自動失敗通知はありません。portal の実行履歴の状態・対象月・完了 run を管理者が確認します。
- トリガーの同時実行数は 1 ですが、この版の排他動作は実機未検証です。手動実行・再送を重ねず、定期実行予定と重ならない作業枠で操作してください。

## 2. 対象月を指定して手動実行する

1. 設定変更前に、現在の KQL_BODY / COLUMNS / MONTH_OVERRIDE とワークフローの有効状態を顧客台帳へ控える。
2. `monthly-export` を無効化し、実行履歴に **Running** がないことを確認する。実行中なら完了を待つ。履歴の自動再実行も重ねない。
3. **環境変数**から MONTH_OVERRIDE を `yyyy-MM` にする。例 `2026-01`。KQL と COLUMNS は目的に合わせて**対で**更新する。文字列形式の厳密検証は未実装なので、存在する年月を確認する。
4. 適用後の再起動が終わるまで待ち、スケジュール開始日時が将来であることを確認する。
5. ワークフローを有効にし、**実行 / トリガーの実行**から 1 回だけ実行する。画面上の表示名は portal の版で異なる。実行できなければ停止し、CLI に切り替えない。
6. 実行履歴で新しい実行 ID、最終状態、`Month` / `StartUtc` / `EndUtc` / `RowCount` と失敗アクションを確認する。
7. [次節](#3-csv-の取得と完了判定)の手順で出力を取得し、対象月・runId・件数を照合する。実行履歴が Succeeded だけでは、完全な抽出の証明にはならない。
8. 試験中は再度無効化する。作業後は元の設定・有効状態へ戻す。通常運用なら MONTH_OVERRIDE を空文字に戻し、次回予定も確認する。

アプリ設定はワークフロー全体で共通です。別実行が参照中に変更しません。設定変更・有効化に伴う想定外の初回発火がないかを履歴で確認します。

## 3. CSV の取得と完了判定

保存先はホストと共用する Storage の **`exports` コンテナー**です。OUT_BLOB_URI にはコンテナー名を含めません。ホスト内部のコンテナー・Queue / Table は閲覧・変更・削除しません。取得者のデータ権限は exports に限定します。

```text
exports（コンテナー）
  <YYYY-MM>/
    current.json
    runs/<run-id>/
      export.csv
      manifest.json
```

1. portal で出力 Storage を開き、**ストレージ ブラウザー → BLOB コンテナー → exports** を選ぶ。認証は **Microsoft Entra ユーザーアカウント**を使う。アカウントキー、SAS、匿名アクセスは使わない。
2. 対象月の `current.json` をブラウザーの表示または許可されたダウンロードで読む。
3. `runId` と `path` を確認する。path は **exports コンテナーを基準とする相対パス**（`<YYYY-MM>/runs/<run-id>/`）である。
4. その path の `manifest.json` と `export.csv` を取得する。更新日時が新しい別 run を勝手に採用しない。
5. manifest の `month`、`runId`、`windowStartUtc`、`windowEndUtc`、`rowCount`、`files`、`completedAtUtc` を確認し、実行履歴と照合する。現実装の files は `["export.csv"]`。

manifest の `rowCount` は JSON 数値です。今回の実機でも数値として保存されることを確認しています。サイズ・ハッシュ・明示的な complete フラグは manifest にはありません。current が示す run と成功履歴の両方を確認します。

- UTF-8 BOM 付き CSV。0 件は `TimeGenerated,Id,Text` など設定したヘッダーと改行のみ。
- CSV の値に改行が入るため、単純なテキストの行数はレコード数ではありません。組織で認めた CSV 対応ソフトのインポート機能で確認します。
- 表計算ソフトでは数式・日付の自動解釈を避け、文字列として取り込みます。不審なログ値を式として実行しません。元ログ値の自動書き換えは行っていません。
- ファイルは閉域管理端末内へ保存されます。管理 VM / Bastion の画面から手元端末へ移せることは保証しません。持ち出しは別途承認された経路に限定します。
- 取得権限不足と閉域到達失敗を区別します。Reader / Contributor などの管理権限だけでは Blob の読み取り権限を満たさないことがあります。

## 4. 再実行と失敗時の扱い

同月再実行では別の run ディレクトリーに新しい CSV / manifest を保存し、その後に current を更新します。旧 CSV を同じ URL で上書きする方式ではありません。

- クエリ・変換・アップロード途中で失敗した run は正式成果物として採用しない。通常、この段階の失敗では前回 current が残ります。
- current 自体の更新で通信障害になった場合は、状態を推測せず current と実行履歴を再確認する。
- 初回失敗時は current がまだ存在しない場合があります。「0 件」と読み替えない。
- トリガー同時実行数 1 を維持し、手動実行を重ねません。別ワークフローを同じ出力先へ接続しても、この設定でアプリ間の排他にはなりません。
- 過去 run / 失敗 run の自動削除はありません。承認済みの保持ルールに従い、current が参照する run を消さないよう管理者が削除します。

| 症状 | portal で確認する点 / 対応 |
|---|---|
| ホストランタイムが ServiceUnavailable | 設定変更後の起動待ちか確認。続くならホスト MI、Storage の 4 ロール、PE、DNS、ネットワーク設定を確認して停止。キー接続文字列を追加しない |
| クエリ / API 接続 401 / 403 | システム MI、LAW の Log Analytics Reader、API 接続のアクセスポリシー、MONITOR_* の 3 設定と connections.json の 2 段階の MI 認証を確認。LAW 公開クエリ、管理コネクタ実行時 URL への HTTPS 送信も確認。ホスト用ユーザー MI やユーザーログインへ切り替えない |
| Blob 403 | 組み込み接続 AzureBlob のシステム MI、exports コンテナーの Storage Blob Data Contributor、取得者の同コンテナーの Data Reader、Blob PE / DNS を確認 |
| Query の時間範囲エラー | デザイナーの Time Range Type と配布値 timerangetype `"3"` / timerange `{}` が「Set in query / クエリで設定」に対応することを確認。内部値を推測せず、別の相対期間で絞らない |
| Query で Token not found | 管理サービス用 audience に加えて additionalAudiences の Log Analytics 用 `https://api.loganalytics.io` があることを確認。メタデータ取得の成功だけで MI 接続を正常と判断しない |
| KQL 構文エラー | 失敗アクションを確認し、同じ LAW のログ画面で KQL を確認。`start` / `end` はワークフローが付加する変数。修正後、重複実行なしで再試験 |
| SchemaMismatch | COLUMNS と KQL の project 順を照合。固定サンプルなら `TimeGenerated,Id,Text` |
| RowCap | 500,000 行以上を検出。自動分割はないため停止し、別途分割設計を行う。上限を外して成功扱いにしない |
| HTTP 200 だが error / PartialError | ワークフローは error を検出すると失敗にする。ただし実際の PartialError 再現は未検証。部分結果を正式出力にしない |
| Rows の Parse JSON 失敗 | value 配列・bag 列の欠損、無応答や異常な応答型は失敗になる。0 件は value が明示的な空配列の場合だけ。履歴を確認し、空配列への置換でエラーを隠さない |
| portal で作成 / 保存できない、再起動で定義が消える | WS1 のサポート確認・コンテンツ永続化ゲート未達として停止。管理 API や一時公開で穴埋めしない |

アクションの再試行は有限の固定間隔です（クエリ 3 回・30 秒、Blob 3 回・10 秒）。管理コネクタ自体の応答・時間制限は別に適用されます。自動分割、指数バックオフ、通知連携を備えた本番運用基盤とは異なります。

組み込み uploadBlob が設定する保存メタデータの Content-Type は、この検証では CSV / JSON とも `text/plain; charset=utf-8` でした。拡張子と本文で CSV / JSON として明示的に開きます。旧 HTTP 版の `text/csv` / `application/json` からの差異であり、MIME 型に依存する後続処理が必要なら別途設計します。本文の UTF-8 BOM・CSV エスケープ・JSON 形式とは別の属性です。

実行履歴にはクエリ結果や CSV の本文が残り得ます。閲覧権限と保持を制限してください。[Secure Inputs / Outputs](https://learn.microsoft.com/en-us/azure/logic-apps/set-up-security-permissions#secure-data-in-run-history) や自動監視は別途設計・確認が必要です。ログ本文・ID・トークンを問い合わせ添付や公開資料へ転記しません。

## 5. 評価環境の後片付け

操作場所：Azure portal。評価後は VM の停止だけで終わらせず、承認した削除範囲をすべて削除します。Storage、PE、WS1、Bastion、NAT などは残っていれば課金が続き得ます。

1. ワークフローを無効化し、実行中でないことを確認する。
2. 必要な CSV / 検証記録を、組織の保存先へ承認済みの方法で保全する。
3. 任意試験で今回追加した **サブスクリプションの診断設定**を、サブスクリプション → 診断設定から削除する。既存の設定は変更・削除しない。LAW を消すだけでは RG 外設定の後片付けにならない。
4. RG 外に今回だけ作った VNet ピアリング、DNS 転送・リンク、ロール割り当て、監視設定等を台帳と照合し、承認対象だけを元に戻す。
5. 専用 RG のリソース一覧と削除ロック / 保持設定を確認する。無関係なリソースがないことを確認して **リソース グループの削除**を実施する。一時 VM / NIC / Disk / Bastion / Public IP / NAT を別 RG に作った場合は、その今回作成物も個別に削除する。
6. 削除の完了を確認し、サブスクリプションの **すべてのリソース**で対象名を検索する。RG 外の診断設定・ネットワーク設定も再確認する。削除処理中・失敗・残存を「完了」と記録しない。
7. 台帳に削除結果・残存有無・対応者を記録する。課金画面は反映が遅れるため、費用がすぐ 0 と表示されることを削除完了条件にしない。

**既存 RG / 既存プランを再利用した場合は、手順 5 の RG 削除を実施しません。** 台帳で今回作成したものだけを個別に選択します。最後のアプリを削除すると、[Web Apps Delete の既定動作](https://learn.microsoft.com/en-us/rest/api/appservice/web-apps/delete?view=rest-appservice-2024-04-01)により空の App Service プランも連動削除され得ます。portal の削除確認で**関連プラン**を削除対象に含めず、既存プランの保持を明示できない場合は**削除を中止**してください。削除後はプラン自体を開き、事前に控えた名前・リージョン・SKU・設定が残ることを確認します。「プランを選択しなかった」だけでは保持の確認になりません。

失敗した検証をやり直す場合も、この専用環境だけを削除・残存確認してから再設計します。既存本番環境や共有 DNS / 診断設定を巻き込まないでください。

## 公開情報の参照先

- [portal での Blob データへの Entra 認証と必要な権限](https://learn.microsoft.com/en-us/azure/storage/blobs/authorize-data-operations-portal)
- [Azure Blob 組み込みの保存・読み取り操作](https://learn.microsoft.com/en-us/azure/logic-apps/connectors/built-in/reference/azureblob/)
- [Monitor Logs 管理コネクタの認証・応答サイズ・件数・タイムアウト](https://learn.microsoft.com/en-us/azure/connectors/connectors-azure-monitor-logs)
- [Standard の MI 接続 JSON と API 接続アクセスポリシー](https://learn.microsoft.com/en-us/azure/logic-apps/authenticate-with-managed-identity)
- [Logic Apps の再試行・同時実行・実行履歴保持の制限と設定](https://learn.microsoft.com/en-us/azure/logic-apps/logic-apps-limits-and-config)

対象月の計算、出力パス、RowCap、再試行回数、current 更新規約、保存 MIME の実測値は本サンプル固有です。コネクタの公開仕様と区別してください。
