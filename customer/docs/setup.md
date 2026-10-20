# 導入手順（Azure portal のみ）

[入口](../README.md) → 本書 → [受入確認](validation.md) → [運用・削除](operations.md)

## 0. 導入可否の確認

以下がすべて揃うまで、リソースを作成しません。

| 確認事項 | 必須条件 |
|---|---|
| WS1 のサポート範囲 | コンテンツ共有なし、初回から Shared Key / PNA 無効、ホスト MI 認証という**組み合わせ**がサポート対象と確認できること。portal の作成・編集・保存、再起動・再配置・スケール時の永続性も確認する |
| 作成と費用の承認 | 対象サブスクリプション、専用 RG、Southeast Asia、WS1 / Storage / PE / LAW と、別途必要な管理接続の構成・費用・削除範囲が承認済み |
| 権限 | RG 内のリソース作成権限に加え、ホスト Storage / 出力 Storage / LAW のロール割り当て権限。Contributor だけでは IAM の付与はできない |
| 操作者のデータ権限 | 出力 Storage に Storage Blob Data Reader、LAW に Log Analytics Reader。必要に応じアプリ設定・ワークフロー操作権限を管理者が付与する。ネットワーク到達と RBAC の両方が必要 |
| 閉域管理経路 | ブラウザー端末から VNet の PE と Private DNS を利用でき、portal / Entra ID / Azure 管理先への必要な送信が可能 |
| ネットワーク | `10.50.0.0/16` が既存網と重複しないこと。既存 AMPLS / DNS への影響がない隔離した評価環境であること |
| サービス | 必要なリソースプロバイダー、WS1 のリージョン提供・容量・クォータ、Azure Policy 適合を portal で確認 |

サポートへの確認例：

> Logic Apps Standard WS1 を ARM で構築し、AzureWebJobsStorage 接続文字列および WEBSITE_CONTENTAZUREFILECONNECTIONSTRING / WEBSITE_CONTENTSHARE を設定せず、ユーザー割り当て MI の AzureWebJobsStorage__* のみで接続します。ホスト Storage は初回から Shared Key 無効・PNA 無効で PE 経由です。この構成はサポート対象ですか。portal でのワークフロー新規作成・編集・保存、再起動・再配置・スケール後もコンテンツが保持され、実行・監視されることは保証対象ですか。

公式資料の「WS プランではキー無効化不可」という記載と矛盾が解消されない場合は停止します。PoC で動いた事実だけで判断しません。

### 閉域管理端末がない場合

本テンプレートは管理用 VM / Bastion / NAT、社内 VPN / DNS 転送を作成しません。承認済みの閉域接続がなければ、ネットワーク管理者と先に用意します。

一時 Windows 管理 VM を認める場合は、専用 RG の `snet-vm` に Public IP なしで作成し、portal の Bastion 接続から VM 内のブラウザーで操作する案です。Bastion は `AzureBastionSubnet`、VM の外向きは承認済み NAT 等を使います。VM 認証情報は組織の規程で管理し、配布物や公開リポジトリへ書き込みません。これは管理用であり自動実行用ではありません。Bastion の管理入口・明示的送信・費用を別途承認してください。Bastion のブラウザー操作は今回まだ実証していません。NAT は送信先を制限する装置ではありません。

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

アドレスは固定です：`snet-ase` は `10.50.0.0/24`（元 PoC の予約、ASE は作成しない）、`snet-pe` は `10.50.1.0/24`、`snet-vm` は `10.50.2.0/24`、`AzureBastionSubnet` は `10.50.3.0/26`、`snet-integ` は `10.50.4.0/24`。別アドレスが必要なら、提供者が Bicep と資料を改訂・再検証してから配布します。

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
- 作成物：VNet、Private DNS、ホスト用ユーザー割り当て MI、ホスト / 出力 Storage、`exports` コンテナー、LAW、AMPLS、各 PE、ホスト Storage の RBAC。
- Storage は両方とも PNA / Shared Key / Blob 匿名アクセス無効。ホスト Storage の blob / queue / table / file PE と出力 blob PE があるが、**Azure Files の共有やキー接続文字列は作成しない**。
- 出力 `vnetName`、`hostSaName`、`outSaName`、`uamiName`、`lawName`、`lawCustomerId`、`outBlobUri` を控える。`lawCustomerId` がアプリ設定 LAW_ID 用のワークスペース ID（GUID）であり、LAW の ARM リソース ID ではない。

期待結果：

1. RG 内の PE が **承認済み**、DNS ゾーングループと VNet リンクがある。
2. Storage の **構成**で共有キーのアクセスが無効、**ネットワーク**でパブリックネットワークアクセスが無効。
3. LAW の公開問い合わせ・公開取り込みが無効。AMPLS は Query / Ingestion とも PrivateOnly。
4. ホスト Storage の IAM に、ホスト用 MI の Storage Account Contributor / Storage Blob Data Owner / Storage Queue Data Contributor / Storage Table Data Contributor がある。

## 4. WS1 とアプリを作成する

投入：[02-app-ws.json](../infra/02-app-ws.json)。入力例：[02-app-ws.parameters.json](../infra/02-app-ws.parameters.json)。

- 手順 3 の出力値から vnetName、hostSaName、uamiName を入力し、承認済み appName / planName を入力する。
- `snet-integ`（Microsoft.Web/serverFarms 委任）、WS1、Logic App、ホスト MI 設定を作成する。
- アプリのシステム割り当て ID とホスト用ユーザー割り当て ID が有効。送信は VNet 統合・全送信 VNet 経由、サイト PNA は無効。
- `appName`、`appHost`、`planName` の出力を控える。

この時点はサイト用 PE と出力権限が未作成なので、ワークフローへ進まず次を実施します。**手順 4 以降に手順 3 をそのまま再投入しないでください**。元の VNet 内サブネット定義に後追加の `snet-integ` がないため、再投入はサブネット変更・削除と競合する可能性があります。やり直しは専用環境の削除から行い、既存運用環境の更新には使いません。

## 5. データ権限とアプリの受信 PE を作成する

投入：[03-access.json](../infra/03-access.json)。入力例：[03-access.parameters.json](../infra/03-access.parameters.json)。

- 手順 3・4 の出力値から vnetName、appName、outSaName、lawName を入力する。
- アプリのシステム割り当て MI に、出力 Storage の Storage Blob Data Contributor、LAW の Log Analytics Reader を付与する。
- アプリ用 PE と `privatelink.azurewebsites.net` の DNS ゾーン / VNet リンクを作成する。

期待結果：

- アプリ用 PE が承認済みで、DNS ゾーンにアプリ名と `<app-name>.scm` のレコードが PE に対応している。欠けていたら停止してネットワーク設定を見直す。
- Storage / AMPLS の既存 DNS ゾーンも同じ VNet にリンクされている。
- アプリの **ネットワーク**で受信 PNA 無効、PE と送信 VNet 統合が確認できる。
- IAM 反映後、閉域端末のブラウザーから LAW の **ログ**と出力 Storage の **ストレージ ブラウザー**へ Entra ID で到達できる。共有キー・SAS に切り替えない。

既存社内端末から利用する場合、VNet リンクだけではオンプレミス DNS の解決は完成しません。DNS 転送・経路をネットワーク管理者が確認します。ブラウザーが portal のローカルネットワークアクセス許可を求める場合は、組織ポリシーに従って許可します。

## 6. アプリ設定を投入する

操作場所：閉域端末内のブラウザーの Azure portal。

1. Logic App の **設定 → 環境変数**（画面によっては構成）でアプリ設定を開く。
2. [sample.json](../settings/sample.json) の各項目を**追加・更新**する。既存のホスト設定全体をこの 5 項目だけで置き換えない。
3. LAW_ID は `lawCustomerId`、OUT_BLOB_URI は `outBlobUri` へ置換する。末尾スラッシュ・コンテナー名は付けない。
4. 初回は MONTH_OVERRIDE=`2026-01`、COLUMNS=`TimeGenerated,Id,Text`、KQL_BODY は固定 datatable をそのまま使う。
5. 適用後は再起動が終わるまで待つ。ホストランタイムの ServiceUnavailable が解消しない場合は停止する。

| 設定 | 意味 |
|---|---|
| LAW_ID | 問い合わせ先のワークスペース ID |
| OUT_BLOB_URI | `https://<出力Storage名>.blob.core.windows.net` |
| MONTH_OVERRIDE | 評価・再抽出時の `yyyy-MM`。空文字は実行時点の JST 前月 |
| COLUMNS | CSV の期待ヘッダー。カンマ区切り、余分な空白なし |
| KQL_BODY | `start` / `end` を参照する KQL。末尾 `project bag=pack_all()` |

ホスト設定の `AzureWebJobsStorage__*` 5 項目は保持します。接続文字列 `AzureWebJobsStorage`、`WEBSITE_CONTENTAZUREFILECONNECTIONSTRING`、`WEBSITE_CONTENTSHARE`、キー / SAS を追加しません。`connections.json` は空で、マネージド API 接続の作成・認証は不要です。

## 7. ワークフローを portal で作成・保存する

> **この経路は実機受入待ちです。** コンテンツ共有なしの WS1 で画面操作が成立するかは未確認です。作成・保存ができない場合、管理 API / SCM / スクリプトで代替して「portal 完結」と扱わず停止してください。

1. ワークフローを作る前に、手順 6 の固定サンプル設定が反映済みであることを確認する。保存直後の予期しない発火でも、本番データを問い合わせないためです。
2. Logic App の **ワークフロー → 追加**から `monthly-export`、**Stateful** を選んで空のワークフローを作成する。
3. 空のワークフローを**無効化**してから、**コード** / **コードビュー**を開く。保存で有効状態に戻る場合がないかも確認する。
4. エディターの最上位を確認する。`definition` と `kind` を含むファイル全体なら [workflow.json](../logicapp/monthly-export/workflow.json)、`$schema` / `triggers` / `actions` から成る定義本体だけなら [definition.json](../logicapp/monthly-export/definition.json) の全内容を貼る。入れ子を二重にしない。どちらとも違う場合は停止して提供者へ確認する。
5. `Monthly_JST_5th_0900` の `recurrence.startTime` に**将来の承認済み初回日時**を設定する。JST で `yyyy-MM-ddTHH:mm:ss`（例：対象月 5 日の `09:00:00`、末尾 Z なし）、timeZone は `Tokyo Standard Time` を維持する。月次は初回を取りこぼさないよう公式資料に従い事前に設定する。既定の `evaluatedRecurrence` が表示される場合も表示と設定の整合を確認する。
6. 保存し、画面を閉じて開き直して定義が残っていることを確認する。無効状態を維持する。月次発火はこの操作だけでは実証されない。
7. [受入確認](validation.md) の順に、有効化・手動実行・再無効化を行う。無効状態で手動実行できなければ、将来の初回日時を確認してから有効化する。

`host.json` はホストの version 2.0 と Workflows extension bundle `[1.*, 2.0.0)`、`connections.json` は `{}` を表す元プロジェクトの参照用です。ARM には対応する extension bundle のアプリ設定を含めていますが、ファイル自体を配置する ARM 操作は含みません。portal がホストファイル配置を要求する、またはコードビューだけでは作成できない場合は、この手順は不成立として停止します。

## 8. 初期受入と通常運用への切り替え

- [受入確認](validation.md) の必須項目を実施し、ワークフロー保存・再起動後の永続化を確認する。
- 実データ用 KQL・COLUMNS、ログ量、保持、通知・排他・エラー処理などの未解決事項は、本番化前に別途設計・承認する。
- 通常の前月抽出は MONTH_OVERRIDE を**空文字**にする。固定サンプルのままスケジュール運用を始めない。
- アプリ設定変更が再起動を伴うことを考慮し、稼働中の実行がない時間帯に行う。
- 実月次発火をまだ観測していなければ、その旨を受入表に残す。

## 公式手順の参照先

- [portal から ARM テンプレートをデプロイ](https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deploy-portal)
- [Standard の作成とワークフロー追加](https://learn.microsoft.com/en-us/azure/logic-apps/create-single-tenant-workflows-azure-portal)
- [Recurrence の開始日時・タイムゾーン](https://learn.microsoft.com/en-us/azure/connectors/connectors-native-recurrence)
- [Azure Monitor Private Link の構成](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/private-link-configure)
