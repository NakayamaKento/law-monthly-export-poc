# 導入手順（Azure portal のみ）

[入口](../README.md) → 本書 → [受入確認](validation.md) → [運用・削除](operations.md)

## 0. 導入可否の確認

以下がすべて揃うまで、リソースを作成しません。

| 確認事項 | 必須条件 |
|---|---|
| WS1 のサポート範囲 | コンテンツ共有なし、初回から Shared Key / PNA 無効、ホスト MI 認証という**組み合わせ**がサポート対象と確認できること。portal の作成・編集・保存、再起動・再配置・スケール時の永続性も確認する |
| 作成と費用の承認 | 対象サブスクリプション、専用 RG、Southeast Asia、WS1 / Storage / PE / LAW と、別途必要な管理接続の構成・費用・削除範囲が承認済み |
| 権限 | RG 内のリソース作成権限に加え、Storage / exports コンテナー / LAW のロール割り当てと API 接続のアクセスポリシー作成権限。Contributor だけでは IAM の付与はできない |
| 操作者のデータ権限 | Storage の **exports コンテナー**に Storage Blob Data Reader、LAW に Log Analytics Reader。必要に応じアプリ設定・ワークフロー操作権限を管理者が付与する。ホスト内部データの権限は付与しない。ネットワーク到達と RBAC の両方が必要 |
| 閉域管理経路 | ブラウザー端末から VNet の Storage / サイト用 PE と Private DNS を利用でき、portal / Entra ID / Azure 管理先への必要な送信が可能 |
| LAW 問い合わせの送信 | Log Analytics は閉域対象外。Logic App から Monitor Logs API 接続の実行時 URL（手順 5 の出力）のホストへ公開 HTTPS 送信できること。管理コネクタが LAW へ公開問い合わせする。VNet 統合・UDR・ファイアウォールと管理コネクタの必要送信先を確認 |
| ネットワーク | `10.50.0.0/16` が既存網と重複しないこと。既存 DNS への影響がない隔離した評価環境であること。共有の AMPLS / DNS により LAW API が意図せず PrivateOnly 経路へ転送されないこと |
| サービス | 必要なリソースプロバイダー、WS1 のリージョン提供・容量・クォータ、Azure Policy 適合を portal で確認 |

サポートへの確認例：

> Logic Apps Standard WS1 を ARM で構築し、AzureWebJobsStorage 接続文字列および WEBSITE_CONTENTAZUREFILECONNECTIONSTRING / WEBSITE_CONTENTSHARE を設定せず、ユーザー割り当て MI の AzureWebJobsStorage__* のみで接続します。ホスト Storage は初回から Shared Key 無効・PNA 無効で PE 経由です。この構成はサポート対象ですか。portal でのワークフロー新規作成・編集・保存、再起動・再配置・スケール後もコンテンツが保持され、実行・監視されることは保証対象ですか。

[公式資料の「WS プランではキー無効化不可」という記載](https://learn.microsoft.com/en-us/azure/logic-apps/create-single-tenant-workflows-azure-portal#set-up-managed-identity-access-to-your-storage-account)と矛盾が解消されない場合は停止します。PoC で動いた事実だけで判断しません。

### 閉域管理端末がない場合

本テンプレートは管理用 VM / Bastion / NAT、社内 VPN / DNS 転送を作成しません。承認済みの閉域接続がなければ、ネットワーク管理者と先に用意します。

一時 Windows 管理 VM を認める場合は、専用の管理用サブネットに Public IP なしで作成し、portal の Bastion 接続から VM 内のブラウザーで操作する案です。**管理用サブネットと `AzureBastionSubnet` は本テンプレートには含めず**、必要になった場合だけネットワーク管理者が別途設計・作成します。VM の外向きは承認済み NAT 等を使います。VM 認証情報は組織の規程で管理し、配布物や公開リポジトリへ書き込みません。これは管理用であり自動実行用ではありません。Bastion の管理入口・明示的送信・費用を別途承認してください。Bastion のブラウザー操作は今回まだ実証していません。NAT は送信先を制限する装置ではありません。

Private-only Bastion は、接続元からの閉域到達手段なしには使えません。公開管理入口も許可されない場合は、既存の閉域経路が整うまで停止します。

## 1. 入力値を用意する

環境固有値の記録は顧客の管理台帳内だけに行い、このサンプルへ書き戻して公開しません。

| 値 | 決め方 |
|---|---|
| サブスクリプション / テナント | 承認済みのもの。以降すべて同じテナント・サブスクリプション |
| 専用 RG | 新規評価用。同じ RG に無関係な本番リソースを置かない |
| location | `southeastasia`。RG の場所とテンプレートの location を揃える |
| prefix | 3～8 文字、小文字英数字、先頭は英字。例 `lawexp`。リソース名は自動生成 |
| retentionInDays | 例は 90 日。LAW の保持の課金・テーブル別設定を承認する。CSV 保持とは別 |
| appName | グローバルに一意な Logic App 名。2～60 文字の英数字・ハイフン、先頭末尾は英数字 |
| planName | RG 内で一意な Workflow Service Plan 名 |
| 以降の入力 | 最初のデプロイの出力から転記する。Storage 名やワークスペース ID を推測しない |

アドレスは固定です：`snet-pe` は `10.50.1.0/24`、`snet-integ` は `10.50.4.0/24`。作成するサブネットはこの 2 個だけです。未使用の ASE・管理 VM・Bastion 用予約サブネットは作成しません。VNet の `10.50.0.0/16` は既存のアドレス計画との整合のため維持します。別アドレスが必要なら、提供者が Bicep と資料を改訂・再検証してから配布します。

## 2. portal カスタムデプロイの共通操作

操作場所：Azure portal にアクセスできる管理端末のブラウザー。データやワークフロー編集は後述の閉域端末を使います。

1. portal で承認済みサブスクリプションの専用 RG を新規作成する。
2. 検索から **カスタム テンプレートのデプロイ**（Deploy a custom template）を開く。
3. **エディターで独自のテンプレートを作成**を選び、対象の ARM JSON をファイルから読み込む、または内容全体を貼り付け、保存する。
4. 同じサブスクリプション・RG を選ぶ。パラメーター例の値を参考に画面の各入力欄へ実値を入力する。例ファイルは ARM 本体ではないのでテンプレート欄へ貼らない。
5. **確認と作成**で値・検証結果を確認してから **作成**する。完了まで待ち、デプロイの **出力**を顧客の台帳へ控える。

すべて **増分（Incremental）**、下記の順序で実行します。Complete モードを使いません。入力不備・ポリシー違反・容量不足で失敗したら、エラーを控えて停止します。公開化やキー認証を有効にしません。

## 3. 基盤を作成する

投入：[01-foundation.json](../infra/01-foundation.json)。入力例：[01-foundation.parameters.json](../infra/01-foundation.parameters.json)。

- location、prefix、retentionInDays を入力する。
- 作成物：VNet、Storage 用 Private DNS、ホスト用ユーザー割り当て MI、**Storage 1 個**、`exports` コンテナー、LAW、Storage 用 PE、ホスト Storage の RBAC。**AMPLS とその PE / DNS は作成しない**。
- Storage は PNA / Shared Key / Blob 匿名アクセス無効。**blob / queue / table の PE 3 個**を作成し、Blob PE はホストと CSV 出力で共用する。**Azure Files の共有・File 用 PE・File 用 Private DNS ゾーン・キー接続文字列は作成しない**。
- 出力 `vnetName`、`hostSaName`、`outSaName`、`uamiName`、`lawName`、`lawResourceId`、`outBlobUri` を控える。`hostSaName` と `outSaName` は同じ Storage 名。LAW_RESOURCE_ID は **ARM リソース ID**であり、ワークスペース GUID（互換出力 `lawCustomerId`）は使わない。

期待結果：

1. RG 内の PE が **承認済み**、DNS ゾーングループと VNet リンクがある。
2. Storage の **構成**で共有キーのアクセスが無効、**ネットワーク**でパブリックネットワークアクセスが無効。
3. LAW の公開問い合わせは **有効**、公開取り込みは不要なので無効のまま。公開クエリの有効化は匿名アクセスの許可ではなく、アプリ MI の Log Analytics Reader が引き続き必要。
4. ホスト Storage の IAM に、ホスト用 MI の Storage Account Contributor / Storage Blob Data Owner / Storage Queue Data Contributor / Storage Table Data Contributor がある。

### 残す接続と除外する接続

ワークフローは Monitor Logs 管理コネクタと Blob 組み込みコネクタを使いますが、**Stateful の実行基盤は別に Blob / Queue / Table を使います**。ワークフローに Queue / Table のアクションがないことは、ホストの Queue / Table 接続を削除できる根拠にはなりません。

| 対象 | PE | Private DNS ゾーン | 判断・理由 |
|---|---|---|---|
| 統合 Storage Blob | 1 個 | `privatelink.blob.core.windows.net` | 必要。ホスト・Stateful 実行と CSV / manifest / current の保存・取得で共用 |
| ホスト Storage Queue | 1 個 | `privatelink.queue.core.windows.net` | 必要。Stateful ランタイムの内部キュー処理用 |
| ホスト Storage Table | 1 個 | `privatelink.table.core.windows.net` | 必要。Stateful ランタイムの状態管理用 |
| 出力専用 Storage / PE | **なし** | **追加ゾーンなし** | exports コンテナーをホストと同じアカウントに置く。アプリ MI と取得者のデータ権限は exports に限定 |
| ホスト Storage File | **なし** | **File ゾーンなし** | 本サンプルは Azure Files のコンテンツ共有を設定しないため除外。一般的な Standard 構成でも File 不要という意味ではない |
| LAW 問い合わせ | **なし** | **Monitor 系ゾーンなし** | 閉域対象外。公開 HTTPS API + MI。AMPLS も作成しない |
| Logic App サイト | 1 個（手順 5） | `privatelink.azurewebsites.net` | 非公開サイト・SCM の管理アクセス用。VNet 統合（送信）とは別 |

最終的に **PE は 4 個、Private DNS ゾーンは 4 個**、各ゾーンの VNet リンクは 1 個ずつです。手順 3 の時点ではサイト用がまだなく、PE は 3 個、ゾーンは 3 個です。

作成する DNS は `privatelink.blob.core.windows.net`、`privatelink.queue.core.windows.net`、`privatelink.table.core.windows.net`、`privatelink.azurewebsites.net` のみです。LAW の閉域化を外したため、`privatelink.monitor.azure.com`、`privatelink.oms.opinsights.azure.com`、`privatelink.ods.opinsights.azure.com`、`privatelink.agentsvc.azure-automation.net` と AMPLS は不要です。

**単一 Storage・コネクタ版は、提供者が管理 API を使い 3 段階の構築・ダミー実行・Blob 保存実体の独立読み戻しに成功**しています。portal だけでの構築・編集保存・CSV 取得は未実証です。ホスト用 MI の管理権限はアカウント全体に必要ですが、CSV 取得者には付与しません。強い管理境界が必要な場合は Storage 分離を別途承認します。WS1 のサポート確認は引き続き必須です。

既存環境を新しいテンプレートで自動的に縮小する手順ではありません。**稼働中の Queue / Table PE や DNS を削除しないでください**。増分デプロイでは旧 File / AMPLS / DNS が自動削除されず、基盤の再投入は後追加のサブネットとも競合します。既存環境の整理では、共有利用・コンテンツ共有・LAW の公開クエリ設定・送信経路・DNS 転送を調査し、変更承認・検証・復旧手順を用意して別途実施します。共有の Blob DNS は削除対象ではありません。

## 4. WS1 とアプリを作成する

投入：[02-app-ws.json](../infra/02-app-ws.json)。入力例：[02-app-ws.parameters.json](../infra/02-app-ws.parameters.json)。

- 手順 3 の出力値から vnetName、hostSaName、uamiName を入力し、承認済み appName / planName を入力する。
- `snet-integ`（Microsoft.Web/serverFarms 委任）、WS1、Logic App、ホスト MI 設定を作成する。
- アプリのシステム割り当て ID とホスト用ユーザー割り当て ID が有効。送信は VNet 統合・全送信 VNet 経由、サイト PNA は無効。
- `appName`、`appHost`、`planName` の出力を控える。

この時点はサイト用 PE と出力権限が未作成なので、ワークフローへ進まず次を実施します。**手順 4 以降に手順 3 をそのまま再投入しないでください**。元の VNet 内サブネット定義に後追加の `snet-integ` がないため、再投入はサブネット変更・削除と競合する可能性があります。やり直しは専用環境の削除から行い、既存運用環境の更新には使いません。

## 5. データ権限・Monitor Logs 接続・アプリの受信 PE を作成する

投入：[03-access.json](../infra/03-access.json)。入力例：[03-access.parameters.json](../infra/03-access.parameters.json)。

- 手順 3・4 の出力値から vnetName、appName、outSaName、lawName を入力する。
- アプリのシステム割り当て MI に、**exports コンテナーのみ**の Storage Blob Data Contributor、LAW の Log Analytics Reader を付与する。
- Azure Monitor Logs の API 接続（`<appName>-logs`、kind V2、Managed Identity）を 1 個と、この接続をアプリ MI だけが使うアクセスポリシーを作成する。Blob は組み込み接続のため Azure 上の API 接続リソースを作らない。
- アプリ用 PE と `privatelink.azurewebsites.net` の DNS ゾーン / VNet リンクを作成する。
- 出力 `monitorApiId`、`monitorConnectionId`、`monitorConnectionRuntimeUrl` を控える。URL を推測したり別リージョンのものを流用したりしない。

期待結果：

- アプリ用 PE が承認済みで、DNS ゾーンにアプリ名と `<app-name>.scm` のレコードが PE に対応している。欠けていたら停止してネットワーク設定を見直す。
- Storage の DNS ゾーンも同じ VNet にリンクされている。LAW は公開 API を使い、AMPLS のリンクや Monitor 系ゾーンは不要。
- アプリの **ネットワーク**で受信 PNA 無効、PE と送信 VNet 統合が確認できる。
- IAM 反映後、閉域端末のブラウザーから LAW の **ログ**と出力 Storage の **ストレージ ブラウザー**へ Entra ID で到達できる。共有キー・SAS に切り替えない。

既存社内端末から利用する場合、VNet リンクだけではオンプレミス DNS の解決は完成しません。DNS 転送・経路をネットワーク管理者が確認します。ブラウザーが portal のローカルネットワークアクセス許可を求める場合は、組織ポリシーに従って許可します。

## 6. アプリ設定を投入する

操作場所：閉域端末内のブラウザーの Azure portal。

1. Logic App の **設定 → 環境変数**（画面によっては構成）でアプリ設定を開く。
2. [sample.json](../settings/sample.json) の全 8 項目を**追加・更新**する。既存のホスト設定全体をこの 8 項目だけで置き換えない。
3. LAW_RESOURCE_ID は `lawResourceId`、OUT_BLOB_URI は `outBlobUri`、MONITOR_* の 3 項目は手順 5 の対応する出力へ置換する。OUT_BLOB_URI に末尾スラッシュ・コンテナー名は付けない。
4. 初回は MONTH_OVERRIDE=`2026-01`、COLUMNS=`TimeGenerated,Id,Text`、KQL_BODY は固定 datatable をそのまま使う。
5. 適用後は再起動が終わるまで待つ。ホストランタイムの ServiceUnavailable が解消しない場合は停止する。

| 設定 | 意味 |
|---|---|
| LAW_RESOURCE_ID | 問い合わせ先 LAW の ARM リソース ID。`/subscriptions/<...>/resourceGroups/<...>/providers/Microsoft.OperationalInsights/workspaces/<...>` |
| OUT_BLOB_URI | `https://<統合Storage名>.blob.core.windows.net` |
| MONITOR_API_ID | 手順 5 の `monitorApiId` |
| MONITOR_CONNECTION_ID | 手順 5 の `monitorConnectionId` |
| MONITOR_CONNECTION_RUNTIME_URL | 手順 5 の `monitorConnectionRuntimeUrl` |
| MONTH_OVERRIDE | 評価・再抽出時の `yyyy-MM`。空文字は実行時点の JST 前月 |
| COLUMNS | CSV の期待ヘッダー。カンマ区切り、余分な空白なし |
| KQL_BODY | `start` / `end` を参照する KQL。末尾 `project bag=pack_all()` |

ホスト設定の `AzureWebJobsStorage__*` 5 項目は保持します。接続文字列 `AzureWebJobsStorage`、`WEBSITE_CONTENTAZUREFILECONNECTIONSTRING`、`WEBSITE_CONTENTSHARE`、キー / SAS を追加しません。旧 HTTP 版の LAW_ID は新しい設定として流用できません。

### 6.1 組み込み / 管理コネクタ接続を設定する

1. Logic App → **ワークフロー → 接続 → JSON ビュー**を開く。
2. [connections.json](../logicapp/connections.json) を貼り付けて保存する。専用の新規アプリ以外では既存接続を消さず、`serviceProviderConnections.AzureBlob` と `managedApiConnections.azuremonitorlogs` のみ追加する。画面で編集保存できない場合は停止し、CLI / SCM の公開化で代替しない。
3. Blob は **組み込み**、認証は **マネージド ID / システム割り当て**、エンドポイントは OUT_BLOB_URI。JSON の正式なキーは **blobStorageEndpoint** と **managedIdentityType: SystemAssigned**。`blobEndpoint` では接続できない。ホスト用ユーザー MI へ切り替えない。
4. Monitor Logs は手順 5 の **管理** API 接続を使う。内部接続と対象リソースの認証をいずれもシステム MI にする。対象リソースの認証には `audience: https://management.core.windows.net/` と **additionalAudiences: [https://api.loganalytics.io] の両方**を保持する。後者がないとメタデータ取得に成功してもクエリが失敗する。ユーザーログイン、キー、サービスプリンシパルのシークレットを登録しない。
5. 保存後に再度 JSON ビューを開き、2 接続と `@appsetting(...)` 参照が保持されていることを確認する。接続状態やデザイナーの動的項目取得が失敗したら、API 接続のアクセスポリシー・アプリ MI・LAW の RBAC・送信先を確認する。

Azure Monitor Logs には組み込み版がないため管理版を採用します。API 接続の追加は REST 直書きを避けるために必要です。Blob / CSV 変換 / 条件分岐は組み込みで、不要な管理コネクタを追加しません。この JSON 保存・接続作成経路も portal 実機受入待ちです。

## 7. ワークフローを portal で作成・保存する

> **この経路は実機受入待ちです。** コンテンツ共有なしの WS1 で画面操作が成立するかは未確認です。作成・保存ができない場合、管理 API / SCM / スクリプトで代替して「portal 完結」と扱わず停止してください。

1. ワークフローを作る前に、手順 6 の固定サンプル設定が反映済みであることを確認する。保存直後の予期しない発火でも、本番データを問い合わせないためです。
2. Logic App の **ワークフロー → 追加**から `monthly-export`、**Stateful** を選んで空のワークフローを作成する。
3. 空のワークフローを**無効化**してから、**コード** / **コードビュー**を開く。保存で有効状態に戻る場合がないかも確認する。
4. エディターの最上位を確認する。`definition` と `kind` を含むファイル全体なら [workflow.json](../logicapp/monthly-export/workflow.json)、`$schema` / `triggers` / `actions` から成る定義本体だけなら [definition.json](../logicapp/monthly-export/definition.json) の全内容を貼る。入れ子を二重にしない。どちらとも違う場合は停止して提供者へ確認する。
5. `Monthly_JST_5th_0900` の `recurrence.startTime` に**将来の承認済み初回日時**を設定する。以下のサンプルは **2026 年 12 月 5 日 09:00（日本時間）**。デザイナーの **Start time（開始時刻）**欄には、引用符なしで次の値をコピーする。**Time zone** は `Tokyo Standard Time`（日本時間）を選ぶ。

   ```text
   2026-12-05T09:00:00
   ```

   コードビューで設定する場合は、`Monthly_JST_5th_0900` 内の **`recurrence` オブジェクトだけ**を次に置き換える。ワークフロー全体やトリガー全体をこの JSON だけで置き換えない。

   ```json
   {
     "frequency": "Month",
     "interval": 1,
     "startTime": "2026-12-05T09:00:00",
     "timeZone": "Tokyo Standard Time",
     "schedule": {
       "monthDays": [5],
       "hours": [9],
       "minutes": [0]
     }
   }
   ```

   - 上記は 2026 年 10 月 20 日時点の具体例であり、日時の承認や実機動作を保証するものではない。**実際の設定時点で少なくとも 1 か月先の、承認済みの月の 5 日 09:00** に変更する。例の日付が過去になった場合や準備期間が足りない場合は、そのまま使わない。月次は初回を取りこぼさないよう、Microsoft Learn の案内に従い少なくとも 1 か月前に設定する。
   - `Tokyo Standard Time` と組み合わせるため、末尾に **`Z` や `+09:00` を付けない**。`Z` を付けると UTC と解釈され、選んだタイムゾーンが無視される。
   - 既定の `evaluatedRecurrence` が表示される場合も、保存後に開始日時・タイムゾーン・スケジュールの表示が設定と整合することを確認する。
   - この Start time は**定期実行の開始日時**で、ダミーデータの抽出対象月とは別。手動テストはこの日まで待たずに行い、MONTH_OVERRIDE はテスト手順どおり `2026-01` にする。
6. デザイナーで Export → **Query** を開く。Azure Monitor Logs の **Run query and list results**（V2）、接続 `azuremonitorlogs`、**Time Range Type（時間範囲の種類）が「Set in query / クエリで設定」**であることを確認する。配布定義の `timerangetype: "3"` / `timerange: {}` は 2026-10-21 の実機メタデータで確認した値で、別途置換するマーカーはない。クエリ内の月境界を別の相対時間で狭めない。画面表示と値が一致しなければ停止して確認する。
7. 保存し、画面を閉じて開き直して定義が残ることを確認する。トリガーの同時実行数は **1** を保持する。無効状態を維持する。月次発火はこの操作だけでは実証されない。
8. [受入確認](validation.md) §2.1 のダミーデータによるテスト実行手順に進み、設定・有効化・手動実行・CSV 確認・再無効化を行う。実ログの取り込みや診断設定は不要。無効状態で手動実行できなければ、将来の初回日時を確認してから有効化する。

`host.json` はホストの version 2.0 と Workflows extension bundle `[1.*, 2.0.0)` の参照用です。ARM には対応する extension bundle のアプリ設定を含めていますが、ファイル自体を配置する ARM 操作は含みません。`connections.json` は手順 6.1 で保存します。portal が別途ホストファイル配置を要求する、またはコードビューとデザイナーで作成・保存できない場合は、この手順は不成立として停止します。

## 8. 初期受入と通常運用への切り替え

- [受入確認](validation.md) の必須項目を実施し、ワークフロー保存・再起動後の永続化を確認する。
- **実データがない評価では通常運用へ切り替えない。** 同書 §2.1 のテスト終了手順に従い、ダミー設定を保持しワークフローを無効化する。以下の通常運用への切り替えは、実データ用の設計・承認後に限る。
- 実データ用 KQL・COLUMNS、ログ量、保持、通知・排他・エラー処理などの未解決事項は、本番化前に別途設計・承認する。
- 通常の前月抽出は MONTH_OVERRIDE を**空文字**にする。固定サンプルのままスケジュール運用を始めない。
- アプリ設定変更が再起動を伴うことを考慮し、稼働中の実行がない時間帯に行う。
- 実月次発火をまだ観測していなければ、その旨を受入表に残す。

## 公式手順の参照先

- [portal から ARM テンプレートをデプロイ](https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deploy-portal)
- [Standard の作成とワークフロー追加](https://learn.microsoft.com/en-us/azure/logic-apps/create-single-tenant-workflows-azure-portal)
- [Recurrence の開始日時・タイムゾーン](https://learn.microsoft.com/en-us/azure/connectors/connectors-native-recurrence)
- [Log Analytics 公開 Query API と認証](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/api/access-api)
- [Standard の Blob / Queue / Table 利用](https://learn.microsoft.com/en-us/azure/logic-apps/estimate-storage-costs)
- [Azure Blob 組み込みの保存・読み取り操作](https://learn.microsoft.com/en-us/azure/logic-apps/connectors/built-in/reference/azureblob/)
- [Monitor Logs コネクタの制限](https://learn.microsoft.com/en-us/azure/connectors/connectors-azure-monitor-logs)
- [Standard の MI 接続 JSON と API 接続アクセスポリシー](https://learn.microsoft.com/en-us/azure/logic-apps/authenticate-with-managed-identity)
- [Contributor の権限とロール割り当ての制限](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/privileged#contributor)
- [非公開 Storage の ARM デプロイと Private Endpoint](https://learn.microsoft.com/en-us/azure/logic-apps/deploy-single-tenant-logic-apps-private-storage-account)
- [Private Endpoint のサービス別 Private DNS ゾーン](https://learn.microsoft.com/en-us/azure/private-link/private-endpoint-dns)
- [portal での Blob データへの Entra 認証と必要な権限](https://learn.microsoft.com/en-us/azure/storage/blobs/authorize-data-operations-portal)
- [Monitor Logs の QueryDataV2 と対応する認証方式](https://learn.microsoft.com/en-us/connectors/azuremonitorlogs/)

追加 audience の設定は、実機結果と [Microsoft の接続生成実装](https://github.com/Azure/LogicAppsUX/blob/main/libs/designer/src/lib/core/actions/bjsworkflow/connections.ts)も照合しています。この公開実装は公式のサポート保証とは区別してください。時間範囲の内部値 `"3"` と接続パラメーターの実機確認は[受入確認](validation.md)に記録しています。
