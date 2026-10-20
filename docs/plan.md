# Log Analytics 月次CSVエクスポート：構成案と検証計画

## 1. 目的・計画の状態

Log Analytics の前月分ログをAzureサービスで毎月抽出し、CSVとして非公開Blob Storageに保存する。運用担当者がAzure portalのブラウザー操作で構築・運用でき、端末へのAzure CLI／Az PowerShell導入やローカルコマンド実行を不要とする。

本書は設計・検証計画であり、リソース作成や実行は未実施。実装開始には計画承認が必要であり、有償リソース作成には対象サブスクリプション・構成・費用・権限の追加承認を必要とする。

インターネット復旧後にMicrosoft Learnの公式資料を再取得して見直した。通常のWorkflow StandardプランではホストStorageのキーアクセスを無効化できないことが確認され、追加要件「ホストを含めキー認証不可」と不適合になったため、前回案をそのまま採用しない。

改訂後の主候補は **Logic Apps Standard＋内部向けApp Service Environment v3（Windows／Isolated v2プラン）**。公式資料はASE v3でのマネージドID設定後のStorageキーアクセス無効化を明記している。ただし「後から無効化できる」と「初回から一度もキー認証を使わず構築できる」は同義ではない。後者のARMテンプレート設計と実機検証を必須ゲートにする。現時点で完成済み・実証済みとは扱わない。

ASE v3のSoutheast Asia提供は公式のリージョン表で確認できた。一方、対象サブスクリプションでのLogic Apps on ASEの選択可否、Isolated v2のクォータ／容量、ポリシー適合は未確認。商品別提供表の取得結果ではLogic Appsの詳細を確認できなかったため、これらを確認済みとは表示しない。

既存コードベースは対象外。新規検証環境のサービス構成・ポータル手順・受入条件を設計する。

## 2. 確定した要件・境界

- 新規検証環境。リージョンは Southeast Asia。
- ログ取得・CSV保存のデータ通信はプライベートネットワークのみ。
- Entra ID認証、Azure管理などに必要な外向き通信は許可可能。データ面のPublic Network Accessは無効化する。
- Automation実行用VMは追加しない。一時的な管理用VM＋Azure Bastionは候補として許容する。
- 現在VPN等の閉域接続はない。お客様端末へのモジュール追加やコマンド実行は行わない。
- 第一候補はLogic Apps Standard。Automationは不採用理由を整理し、Functionsは比較のみ。
- CSV保管先は非公開Azure Blob Storage。本番では社内ネットワークからPrivate接続で取得する。
- 月次ログ量・対象テーブル・本番KQL・保持期間は未定。少量サンプルで機能・閉域性を検証し、本番全量処理の保証とは分ける。
- 初期仕様は毎月5日09:00日本時間に、前月の日本時間の暦月を抽出する。UTF-8、分割CSV可、0件はヘッダーのみ。
- 同月再実行は同じ論理出力先の結果を置換する。失敗・部分結果を成功にしない。
- 固定費のある候補構成は許容。実デプロイ前に費用と構成を別途確認する。
- ホストStorageを含めキー認証を禁止する。出力用とホスト用の双方でShared Keyアクセスを無効化し、SAS・接続文字列へのフォールバックを行わない。
- 非公開Storageを初期構築するため、準備したARMテンプレートJSONをAzure portalのカスタムデプロイ画面から投入することを許容する。ローカルCLI、Cloud Shell、PowerShell実行は使用しない。
- サンプルAzureActivityの取り込みは、診断設定のMicrosoft非公開サービス間チャネルを許容する。Private Endpoint経由ではない例外として記録する。月次の問い合わせとCSV保存はPrivate Endpoint経由のまま。
- 管理用VMの外向き通信にNAT Gatewayを候補として使用する。これは送信経路でありVMへの着信公開ではない。NATは宛先制限機能を持たない。
- 本番対象テーブルのAnalytics保持は90日を候補にし、設定・課金は別途承認する。CSV側の保持期間は別途決定する。
- Logic Apps優先を維持し、ASE v3案を主候補にすること、キー認証なしの初期構築検証と費用承認を必須とすることをユーザーと確認した。

## 3. 候補比較

| 候補 | 閉域データ通信との適合 | 運用担当者への適合 | 本計画での扱い |
|---|---|---|---|
| Azure Automation クラウドRunbook | AutomationアカウントにPrivate Endpointを作るだけでは、クラウド実行環境から利用者VNet内の非公開Log Analytics／Storageへ到達できない | PowerShell中心の運用には向くが、今回のネットワーク制約を満たさない | 採用しない。Private Endpointと実行環境のVNet接続を混同しない |
| Automation＋Hybrid Runbook Worker | 利用者ネットワーク内の実行ホストから閉域接続可能 | Runbookの保守に加え実行ホストの保守が必要 | 実行用VM追加不可の条件から対象外。既存Workerが将来利用できる場合のみ再評価 |
| Logic Apps Consumption | 共有マネージドコネクタを使った単純構成では、今回必要な任意の閉域接続を満たす前提にできない | デザイナー中心で扱いやすい | 今回は採用しない |
| Logic Apps Standard／Workflow Standardプラン | VNet統合とPrivate Endpointは利用可能だが、ホストStorageのキーアクセスを無効化できない | ブラウザー中心で扱いやすい | 追加されたキー認証禁止要件に不適合。不採用 |
| Logic Apps Standard／ASE v3（Windows） | 内部VIPによる受信、VNet内の実行、Private Endpoint経由のデータ接続。ホストStorageのMI認証とキーアクセス無効化に公式の記載あり | デザイナー中心で運用可能だが初期基盤は大きくなる | 改訂後の条件付き第一候補。初回からのキー認証なし構築・費用承認が必要 |
| Azure Functions | 対応プランのVNet統合等で実現候補になる | コード・デプロイ・例外処理の保守が増える | ユーザー希望により比較のみ。Standardで満たせない場合も勝手に切り替えない |
| Log AnalyticsのネイティブData Export | 月次KQL実行＋CSV生成の代替ではない。継続エクスポートは目的と出力形式が異なる | 別途変換処理が必要 | 今回の主案にはしない |

## 4. 推奨構成

```text
運用端末（ブラウザー、追加CLIなし）
  └─ Azure portal／Azure Bastion
       └─ 一時的なWindows管理用VM（Public IPなし、VNet内）
            ├─ Azure portalのデザイナー／実行確認
            └─ Private接続でCSVをVM内へダウンロードして検証

内部向けASE v3（Windows／Isolated v2）
  └─ Logic Apps Standard：Statefulワークフロー
  Recurrence → 対象月確定 → 分割してKQL問い合わせ → CSV生成 → Blobへ保存
       │ ASEのVNet内から送信（通常のWSプランのVNet統合とは別構成）
       ├─ AMPLS Private Endpoint → Log Analyticsクエリ
       └─ Blob Private Endpoint → 非公開出力Storage

Logic Appsの受信：ASE内部VIP（外部VIPは使用しない）
Logic Appsの実行基盤：非公開・Shared Key無効のホストStorage
名前解決：AMPLS／Storage／ASEアプリ・SCMのPrivate DNS
認証：ワークフロー用システム割り当てID、ホスト用ユーザー割り当てID
管理VMの外向き：NAT Gateway → portal／Entra ID等の必要な管理接続
```

ASEの内部VIPで閉域受信を実現するため、通常のWSプラン案のアプリ用Private Endpointをそのまま重ねて作らない。ASEからのアプリ送信とプラットフォーム管理通信は公式要件に従い、通常のWS向け設定を機械的に流用しない。

### 4.1 リソースと接続

| リソース | 役割・設計条件 |
|---|---|
| 専用リソースグループ | 検証物を識別し、削除対象を限定する |
| VNet／サブネット | ASE専用の委任サブネット（Microsoft.Web/hostingEnvironments、/24を候補）、Private Endpoint用、管理用VM用、AzureBastionSubnet（/26以上）を分離。アドレス範囲は既存ネットワークと競合させない |
| 内部向けASE v3＋Windows Isolated v2プラン | 内部VIP。Logic Appsに対応するWindows構成。ASEサブネットに他リソースを配置しない。SKU・インスタンス数・リージョン容量は作成前に確認 |
| Logic Apps Standard | ASE上のStateful。問い合わせ・出力用のシステム割り当てIDとホスト用ユーザー割り当てIDを分離。通常のWorkflow Standard WS1は使用しない |
| ホスト用Storage | Public Network Access・匿名・Shared Keyを無効化。Blob／Queue／TableのPrivate Endpointを基本候補とし、ホスト用ユーザー割り当てIDで認証する。通常のWSプランのAzure Files接続文字列・File PE構成を流用しない。ASEのコンテンツ配置・永続化と初期起動がキーなしで成立することを実証するまでゲートを開かない |
| 出力用Storage | ホスト用と分離。Blob Private Endpoint、Public Network Access無効、匿名アクセス無効、Shared Key無効。システム割り当てマネージドIDで書き込む |
| Log Analytics Workspace | 月次抽出対象。公開クエリ・公開取り込みの扱いを明示し、検証用は双方を無効化する。既存本番ワークスペースの設定は変更しない |
| Azure Monitor Private Link Scope（AMPLS） | Workspaceを関連付け、Private EndpointとPrivate DNSを構成。query／ingestionはPrivateOnlyを基本とし、Workspace自身の公開禁止設定も別に設定する。AMPLSだけで全公開取り込みや流出先が制限されるとは扱わない |
| Private DNS | AMPLSの5ゾーン、ホスト／出力Storageの必要なゾーン、ASEアプリ／SCM用ゾーン。重複するprivatelink.blob.core.windows.netは共有し、レコードを競合させない |
| 一時的な管理用VM | Public IPなし。ブラウザーからデザイナー、プライベートBlob、KQLへアクセスする。Automation Workerとしては使用しない |
| Azure Bastion | 検証端末からVMへのブラウザー管理経路。公開フロントエンドを使う場合は「管理入口の例外」として別途承認する。データサービスを公開するものではない |
| NAT Gateway／送信用Public IP | 管理VMの明示的な送信経路。既定の外向きアクセスに依存せず、VMにはPublic IPを付けない。NATはFirewall／宛先フィルターの代わりではない |

### 4.2 初期構築とホストのキー認証禁止

- 通常のLogic Apps作成ウィザードで非公開Storageへ展開する方法は、一時的な公開アクセスが必要と公式に記載されている。ARMテンプレート方式は公開アクセス不要。ユーザー確認により、portalの「カスタムテンプレートのデプロイ」から投入する方式を採用する。
- 上記の一般的な閉域WSサンプルはキー認証なしを保証しない。既存サンプルをそのまま投入せず、ASE構成とキー認証禁止を反映したテンプレートを別途作成・検証する。
- ユーザー割り当てIDを先に作り、ホストStorageに必要なRBACを設定する。アプリには `AzureWebJobsStorage__managedIdentityResourceId`、`__blobServiceUri`、`__queueServiceUri`、`__tableServiceUri`、`__credential=managedIdentity` を初回から設定する。
- 公式手順のホスト用ロールはStorage Account Contributor、Storage Blob Data Owner、Storage Queue Data Contributor、Storage Table Data Contributor。ワークフロー用IDに横展開せず、ホストStorageだけに限定する。権限削減は起動要件を確認してから検討する。
- Storageキーの読み出し、キー接続文字列、キー由来のSAS、公開アクセスへの一時退避をテンプレートや手順に含めない。ARMの依存順序とRBAC伝播を考慮し、必要なら段階デプロイする。
- 初回からShared Key無効・非公開の状態で起動、デザイナー編集、保存、再起動後の復旧、Stateful履歴が成功することを確認する。公式資料は設定変更後のキー無効化を説明しており、この初回構築経路までは実証していない。
- この検証に失敗した場合は、キーを一時的に許可せず停止する。ASEの費用承認前にテンプレート設計を確認し、有償構築後もこの小さな起動試験に合格するまでワークフローを作り込まない。

### 4.3 ネットワーク・認証上の重要条件

1. マネージドコネクタは、Logic AppsをVNet統合しても実行場所が同じVNetになるとは限らない。Log AnalyticsやBlobの共有コネクタがPrivate Endpointに到達する前提にしない。
2. 組み込みHTTPで `POST https://api.loganalytics.azure.com/v1/workspaces/{workspaceId}/query` を呼ぶ。URIは現行のazure.com、マネージドIDのaudienceはAPI認証資料の `https://api.loganalytics.io` を初期値とし、実機で認証・Private DNSのCNAME連鎖・PEへの到達を確認する。既定のARM audienceを使わず、management.azure.comのQuery経路へ切り替えない。
3. Blobの組み込みコネクタはマネージドIDとUpload blob操作の対応を確認済み。システム割り当てIDで使う。Content-Type等の指定が組み込み操作で満たせない場合だけ組み込みHTTP＋Blob RESTを使い、Storageのaudienceを明示する。キー・SAS・共有マネージドコネクタへの切替はしない。
4. Query用IDは検証Workspaceに限定したLog Analytics Reader等の必要な読取権限、Blob書込は出力コンテナーに限定したStorage Blob Data Contributorを基本に、実際のAPI権限を確認する。ワークフロー用IDにはサブスクリプション／RGのOwner・Contributorを与えない。ホスト用IDの公式ロールは4.2の別管理とする。
5. ホストと出力の両方でShared Keyアクセスを禁止する。ホストはユーザー割り当てID、Queryと出力はシステム割り当てIDとし、それぞれのRBACを分離する。
6. Storageの「信頼されたMicrosoftサービスを許可する」やサービスエンドポイントを、Private Endpointの代用にしない。
7. Entra ID／ARM／ポータル／Bastionなど必要な管理通信の許可先を整理する。「全通信がPrivate Link」という説明はしない。
8. 管理用VMのブラウザー、アプリホスト、外部端末でそれぞれ名前解決とアクセス可否を確認する。Public Network Access無効化だけで、実行時の経路検証を省略しない。
9. プライベート化されたアプリのデザイナー・実行履歴等は、通常のインターネット接続端末から完全操作できる前提にしない。VM側ブラウザーから操作する。
10. Bastionのブラウザー接続でCSVファイル自体を運用端末へ転送できるとは扱わない。本検証ではVM内へのダウンロードと内容確認まで。本番社内端末へのダウンロードは別の閉域接続が必要。
11. Azure Monitor公式資料は、Resource Manager API経由のクエリはPrivate Linkを使えず、対象にLogicApp connectorが含まれると明記している。Logsコネクタを使わず、直接Query API経路を検証する理由はこれである。
12. AMPLSのDNSは `privatelink.monitor.azure.com`、`privatelink.oms.opinsights.azure.com`、`privatelink.ods.opinsights.azure.com`、`privatelink.agentsvc.azure-automation.net`、`privatelink.blob.core.windows.net`。既存の顧客DNSには接続せず、PoC専用VNetにリンクする。
13. ASEは `<ase-name>.appserviceenvironment.net` のPrivate DNSゾーンを基本に、`*`、`@`、`*.scm` を内部VIPへ解決する。ホスト／出力Storageも同じVNetからPrivate IPへ解決する。
14. 管理VM内のEdge／ChromeでportalのLocal Network Access許可が必要な場合がある。社内ブラウザーポリシーと合わせて確認し、閉域であるのにLogs画面だけ失敗するケースを試験する。
15. 診断設定によるAzureActivity取り込みはMicrosoftの安全な非公開チャネルを使い、Workspaceの公開取り込み制限の例外となる。この経路をPrivate Endpoint経由と説明しない。

## 5. ワークフローの動作設計

### 5.1 月次処理

- Recurrenceに日本時間を明示し、毎月5日09:00に起動。
- 起動時に前月の開始・当月の開始を一度だけ確定する。日本時間で月境界を作ってからUTCへ変換する。
- KQLは `TimeGenerated >= startUtc and TimeGenerated < endUtc` の半開区間とする。UTCの月初をそのまま使わない。
- 再実行時は対象月を固定できるよう、初期変数に検証用上書き値を設ける。通常時は自動算出する。月次再処理は運用手順に残し、過去の実行を無条件に再送信する方式に依存しない。
- 対象テーブルと列順を固定したKQLの `project`、Select、Create CSV tableを使う。初回は1テーブル。型やスキーマの自動推測を増やさない。
- 日単位の分割を初期候補とし、API応答量・行数・時間上限を超える場合は時間窓を短縮する。日単位なら必ず安全、とは判断しない。
- 本番量が未知のため、少量PoCの成功のみで本番全量処理を承認しない。超過を検出した場合は明示的に失敗させ、細分化後に再処理する。無制限の自動再帰分割は初期範囲外。
- Query APIの公式上限は1クエリ500,000行、圧縮64 MB（展開後およそ100 MiB）、実行10分。StandardのHTTP送信タイムアウト既定値は225秒、APIの既定値は180秒であり、API上限まで待てると仮定しない。PoCではAPIの待機を180秒以下に保ち、遅い場合は分割を小さくする。
- Logic Appsの通常メッセージ上限100 MBとJSON→配列→CSV変換時の増幅も考慮する。APIの最大応答サイズをそのまま安全なCSV生成サイズとしない。Query APIに汎用nextLinkで全件ページングできる前提を置かない。
- PoCの初期運用ガードは1分割10,000行以下、取得後JSONと生成CSVはそれぞれUTF-8で5 MiB以下を候補にする。これはサービス上限ではない。超過時は成功にせず分割変更を要求する。バイト数を文字数で代用しない。大きなHTTP応答を受信前に必ず防げるものでもないため、事前件数確認と固定サンプル量で試験する。
- 翌月5日の抽出では前月初日のデータが既定の短い保持期間を超えることがある。対象テーブルのAnalytics保持を90日候補とし、長期保管のみのデータを通常Query APIで読めると仮定しない。テーブル個別設定・再実行猶予も確認する。

### 5.2 CSVと出力構造

- UTF-8、列順固定、ヘッダーあり。BOMの必要性は本番利用ツールが判明してから確認する。
- カンマ、二重引用符、改行、日本語、null、日時を含むサンプルでCSVの往復一致を確認する。dynamic型はKQLで明示的に文字列化する。
- CSVには型情報がないため、nullの表現と空文字列の区別を期待値に明示する。型を含む無損失バックアップと説明しない。
- 0件ではヘッダーのみを生成する。Create CSV tableが空配列から必要なヘッダーを生成できるか確認し、必要なら明示的な0件分岐を用意する。
- 保存先例：`exports/<workspace>/<table>/<YYYY-MM>/current.json` と、`runs/<run-id>/part-<window>.csv`、`runs/<run-id>/manifest.json`。
- manifestには対象月・UTC境界・実行ID・クエリ識別子・分割一覧・行数・ファイルサイズ・完了状態を記録する。CSVデータそのものや認証情報を管理ログへ複写しない。
- 出力CSVのContent-Typeを明示する。表計算ソフトでの自動解釈を防ぐ利用方法も運用手順へ記載し、元ログの値を勝手に変換しない。

### 5.3 再実行、失敗、部分結果

- 同一月を含む同時実行を防ぐ。初期構成ではトリガーの同時実行数を1とする。
- 月内のファイルを直接順次上書きして新旧混在させない。run-id別に新しい一式を作り、全分割の成功後に単一の `current.json` を置換して最新完了分を指す。
- これにより同じ論理出力先の置換を実現するが、物理的に同じCSV URLを上書きする仕様ではない。利用者はcurrentに記載された完了済みファイル群を取得する。
- 失敗時は前回のcurrentを保持し、今回の未完了出力を正式成果物と扱わない。運用者は対象月、完了状態、実行IDを確認する。失敗run／旧runの削除は承認済み保持ルールに従う。
- HTTP失敗だけでなくLog Analyticsの部分成功・応答内エラー・想定外テーブル構造を検出する。制限による切り捨てを成功にしない。
- 公式API仕様ではHTTP 200でも `error.code=PartialError` が入り得る。`tables`、期待する `columns`／列順、`rows` を検証し、errorがあればcurrentを切り替えない。204や本文なし200を無条件に「0件成功」に変換しない。0件成功は期待スキーマを持つ空結果で確認する。
- 検証時は同じフィルターの件数問い合わせとCSV行数を比較する。ただし取り込み中・遅延取り込み・保持期限によるデータ変動を考慮し、固定サンプルで厳密一致を確認する。件数一致のみを全件性の唯一の根拠にはしない。
- 429／一時障害は有限の指数バックオフ、認証・権限・構文エラーは失敗とする。Try/Catch/Finally相当のScopeとrun-afterを使い、最終的な失敗状態を保持する。
- 実行履歴の保存やSecure Inputs/Outputsを評価し、ログ本文・トークンの漏えいを防ぐ。運用監視は状態・件数・対象月を中心とする。
- 初期検証ではportalの失敗状態・メタデータで検知確認を行う。本番通知先が未定のためメール等の自動通知は未接続であり、本番化前にAction Group等の承認済み通知経路を確定する。

## 6. サンプルログの準備

### A. 経路・CSV変換の最小検証

Log Analyticsへ実際に問い合わせ、KQLの `datatable` で固定サンプルを返す。日本語、カンマ、引用符、改行、null、月境界直前・直後、同一時刻の複数レコード、識別用IDを含める。対象期間を明示してフィルターし、期待行数とID集合を事前に固定する。

これは「Log Analytics APIへの閉域到達とCSV化」の検証であり、Workspaceへの取り込みや実テーブルの抽出を証明するものではない。

### B. 実際に取り込まれたログでの検証

管理用VMなど検証リソースの操作からAzureActivityのサンプルを発生させ、サブスクリプションの診断設定で検証Workspaceへ送る。これはPrivate Link経由ではなく、Microsoftの安全な非公開サービス間チャネルで、ユーザーが許容した取り込み例外である。サブスクリプションの診断設定を変更する権限、既存設定への影響、送信対象カテゴリを作成前に確認する。

ブラウザーのLogs画面から対象レコードの到着を確認してから、テーブル抽出を実行する。AzureActivityの月全体は固定の期待件数にせず、検証用の識別可能なリソースや相関ID等で対象を絞る。

新規Workspaceには前月の実ログが存在しないため、実テーブル検証では対象期間を一時的に当月の検証窓へ指定する。前月計算と月境界はAの固定サンプルで別途検証する。過去TimeGeneratedを任意に設定できる前提や、1か月待つ前提にしない。

Workspaceの公開取り込み禁止は維持する。サンプル取り込みにDCR／DCEを追加する必要はない。診断設定の非公開サービス間チャネルという例外を本番の関係者が認めない場合は、別途DCR／DCE方式を再設計し、公開取り込みを有効化しない。

## 7. 検証の進め方・受入条件

| 段階 | 実施内容 | 合格条件／停止条件 |
|---|---|---|
| 0. 設計確認 | 下記の公式確認結果を基に、ASE用のARMテンプレート、キーなしの初期化、コンテンツ配置、SKU／リージョン／ポリシーを確認 | 公開化・キー認証を必要とする設計なら停止。ASEの提供表だけで対象サブスクリプションの利用可否を保証しない |
| 1. 設計・課金・権限承認 | サブスクリプション、ASE／Isolated v2、Bastion、NAT、Storage、PE、IAM、保持ルールと費用を確定 | ASEを含む具体的な構成と課金、Bastion管理入口を明示承認。前回のWSプラン前提の承認で代用しない |
| 2. 閉域基盤作成 | portalのカスタムデプロイでVNet、DNS、PE、Storage、ID、Workspace、AMPLSを構成。ASE、管理VM／Bastion／NATも承認済み構成で作成 | データ面は最初から非公開・Shared Key無効。キー取得や公開アクセスへの退避をしない |
| 3. 最優先のキーなし起動試験 | 初期設定済みユーザー割り当てIDでASE上のLogic Appsを起動。BastionからVM内ブラウザーで編集・保存・履歴・再起動を確認 | 初回からキー接続文字列なしで起動・永続化・再起動が成功。失敗時は停止し、以降の作り込みへ進まない |
| 4. 最小サンプル実行 | 組み込みHTTPでdatatableを問い合わせてCSV保存 | 実際のLog Analytics経由、MI認証、期待した行数・値・列順で非公開Blobに出力 |
| 5. 取り込み済みログ | AzureActivityの到着を確認して指定窓を抽出 | 保存済み実テーブルの対象ID・件数とCSVが整合。AとBの結果を区別 |
| 6. 正常・境界・0件 | 月跨ぎ、年跨ぎ、日数の異なる月、開始ちょうど／終了ちょうど、特殊文字、0件を試験 | 日本時間の前月のみを重複・欠落なく抽出。CSVを再解釈した値が一致。0件はヘッダーのみ |
| 7. 再実行 | 同じ対象月を複数回処理し、途中失敗も発生させる | 完了runのみcurrentへ反映。前回成功分を破壊せず、新旧ファイルの混在・二重計上がない |
| 8. 異常系・上限 | 一時的な権限除外、到達不能、無効KQL、テスト用の小さな上限による超過を試す | 明示的な失敗、有限リトライ、未完了成果物を公開しない。部分応答の扱いを確認 |
| 8a. 部分応答・認証禁止 | 実API呼出しと分離したテスト用ワークフロー内の固定応答で200＋PartialError、本文なし、列不一致を入力。ホスト／出力StorageのShared Key無効と接続設定を確認 | 期待する異常分岐・current保持。模擬応答試験を実APIのPartialError再現と混同しない。再起動後もキーなしで稼働 |
| 9. 閉域性の立証 | 外部端末とVM内ブラウザーのアクセス差、PNA、DNS、PE状態、必要に応じ既存診断手段を確認 | 正規権限があっても外部からBlob読取・LA公開クエリ不可。内部とアプリからのみ成功。401/403だけで閉域と判定せず、ネットワーク設定とエラー理由を突合 |
| 10. スケジュール | 同じ処理を短周期の検証用スケジュールで実行後、月次設定へ戻す | 自動起動の証跡、JSTの月次設定、次回対象月、並列制御を確認。月次本番運用を長期実証したとは説明しない |
| 11. ファイル取得 | 管理用VM内ブラウザーでBlobをダウンロードし内容を確認 | VM内のCSV閲覧成功。本番社内端末への取得はVPN等の別途経路がない限り未検証と明記 |
| 12. 運用引継ぎ・終了 | KQL／対象月変更、再実行、失敗判別、保持と削除手順を確認 | 非開発者がブラウザーのみで操作できる手順と証跡がある。削除は対象を明示し別途承認 |

### 測定・証跡

- リソース設定、Private Endpoint承認状態、Private DNSリンク、Public Network Access設定。
- ASE内部VIP、専用委任サブネット、ホストと出力StorageのShared Key無効、ホスト用IDの初回設定、管理VMのNAT送信経路。秘密を表示しない構成証跡と実行結果を突合する。
- Logic Apps実行ID、対象期間、成否、分割数、期待／実測行数、出力サイズ。
- CSVのヘッダー・値・識別子集合の照合結果。改行を含むCSVの行数を単純な改行数で数えない。
- Log Analytics API応答の完全性、異常時のエラー、currentの切替／保持。
- サンプル量の範囲と本番量未検証を明記。
- スクリーンショットや証跡に顧客ログ本文・トークン・秘密情報を含めない。

## 8. 実装・検証Todo

1. 公式仕様の再調査と通常WSプランの適合性見直し（今回完了）。
2. キーなしのASE初期構築用ARMテンプレート、段階デプロイ手順、ユーザー割り当てID／RBAC、コンテンツ永続化方式を設計・検証する。成果物はテンプレートとブラウザー操作手順で、実行環境へのCLI導入は不要。
3. 対象サブスクリプションのASE／Logic Apps／SKU／ポリシーを確認し、具体的な費用・権限・管理入口・保持・削除方針の承認を得る。
4. portalから閉域基盤とASE／Standard／管理経路を構築する。
5. 初回からキーなしの起動、編集、保存、Stateful履歴、再起動を実証する。このゲートに不合格なら以降を止める。
6. 固定サンプルと診断設定による取り込み済みサンプルを用意し、期待値を定義する。
7. 月次ワークフロー、CSV生成、分割、再実行、失敗処理、完了ポインターを構築する。
8. 正常・境界・異常・閉域性・キー禁止・スケジュール・取得試験を実施し証跡を残す。
9. 運用手順・本番移行前の未決事項・検証リソースの停止／削除方針を整理する。

## 9. 本番化前の未決事項と停止条件

- 本番テーブル、KQL、月次件数・サイズ・ピーク日、API制限、想定実行時間。
- 対象テーブルのプランにおけるQuery API対応、保持期間、遅延取り込みの扱い。5日実行で前月ログが完全とは保証せず、締め処理・再抽出方針を定義する。
- ASE／Isolated v2プラン、ホスト／出力Storage、PE、Bastion、管理用VM、NAT Gateway、ログ取り込み／クエリ等の費用。通常WSプランの見積もりを流用しない。金額は公式の現行料金と構成確定後に別途提示する。
- 本番のCSV保持期間、旧run／失敗runの扱い、バージョニング、イミュータブル保管等の要否。未承認の自動削除は設定しない。
- 自動通知先、実行履歴保持、権限分離、データ取り扱い規程。
- 管理用VM／Bastionが必要な運用範囲。本番で毎回一時VMを作る前提にせず、既存社内閉域端末の可用性を確認する。
- Bastionの公開管理入口も禁止なら、Private-only BastionだけではVPNのない端末から到達できない。承認済み閉域管理経路を確保するまで構築・操作は停止する。
- 本番社内ネットワークからのPrivate DNS／Storage到達性。本PoCのBastion接続で代替検証済みとはしない。
- portalのカスタムデプロイによるARM投入は合意済み。ただし非公開・Shared Key無効のASE用ホストStorageで初期構築・コンテンツ永続化・デザイナー編集が成立しない場合は停止する。キー認証を許可する回避策は採らない。
- ASEへの移行で通常WSのFile接続文字列を排除できること、ASEのコンテンツ配置とホストのMI接続が共存することを実機で確認する。公式の「設定変更後にキー無効化可能」という記述だけで初期構築成功を保証しない。
- ASE on Logic AppsのSoutheast Asia／対象サブスクリプションの利用可否、Isolated v2容量、Azure Policy／RBAC伝播は構築前後の確認が必要。未承認のリージョン変更をしない。
- 本番ログ量が安全な処理範囲を超える場合は分割設計等を再評価する。公開化、上限無視、Functionsへの無断移行はしない。

## 10. 公式資料の再確認結果

以下は今回本文を取得して確認した一次資料。資料上の機能対応と、この構成を実機で検証済みであることは区別する。

| 資料 | 確認した事実・計画への影響 |
|---|---|
| [Standard作成／ホストStorageのMI設定](https://learn.microsoft.com/en-us/azure/logic-apps/create-single-tenant-workflows-azure-portal#set-up-managed-identity-access-to-your-storage-account) | 通常Workflow Service Planではキーアクセスを無効化できない。ASE v3はMI設定後に無効化可能。ユーザー割り当てID、必要ロール、AzureWebJobsStorage設定を確認 |
| [非公開StorageへのStandardデプロイ](https://learn.microsoft.com/en-us/azure/logic-apps/deploy-single-tenant-logic-apps-private-storage-account) | 通常portal作成は一時公開が必要、ARM方式は不要。ASE向けキーなしテンプレートの完成例と誤認しない |
| [ARMテンプレートのportal投入](https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deploy-portal) | カスタムテンプレートをportalのエディターから投入可能。端末へのCLI導入は不要 |
| [ASE概要・リージョン](https://learn.microsoft.com/en-us/azure/app-service/environment/overview) | ASEはStandard Logic Appsをホスト可能。Southeast AsiaのASE／Isolated v2提供記載あり。Logic Apps個別の契約・容量適合は別確認 |
| [Logic Appsホスト方式比較](https://learn.microsoft.com/en-us/azure/logic-apps/single-tenant-overview-compare) | Logic Apps on ASE v3はWindowsプランのみ。通常WSとASEのホスト方式を分離 |
| [ASEネットワーク](https://learn.microsoft.com/en-us/azure/app-service/environment/networking) | 専用サブネット、内部VIP、委任、DNS、NSGの要件を確認。アプリ用PEがなくても内部VIPで閉域受信を構成できる |
| [StandardのVNet／Private Endpoint](https://learn.microsoft.com/en-us/azure/logic-apps/secure-single-tenant-workflow-virtual-network-private-endpoint) | 通常WSではVNet統合は送信、PEは受信。ホストStorage依存を含めた設計が必要 |
| [組み込みBlobコネクタ](https://learn.microsoft.com/en-us/azure/logic-apps/connectors/built-in/reference/azureblob/) | Managed identity認証、Upload blob操作、上書き指定の対応を確認 |
| [Logic AppsのマネージドID](https://learn.microsoft.com/en-us/azure/logic-apps/authenticate-with-managed-identity) | StandardのHTTP／Blob組み込み操作がMIをサポート。Blob組み込み用はシステム割り当てIDを基本にする |
| [AutomationのPrivate Link](https://learn.microsoft.com/en-us/azure/automation/how-to/private-link-security) | cloud jobsはPEで保護されたリソースに接続不可。Hybrid Workerが必要で今回の実行ホスト制約に不適合 |
| [Azure Monitor Private Link設計](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/private-link-design) | ARM経由クエリはPrivate Link不可でLogicApp connectorが該当。診断設定の安全な非公開チャネルは公開取り込み禁止設定の例外 |
| [Azure Monitor Private Link構成](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/private-link-configure) | DNSの5ゾーン、APIのprivateレコード、portalのLocal Network Access許可を確認 |
| [Query APIアクセス・認証](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/api/access-api) | 現行URIはapi.loganalytics.azure.com、認証resourceはapi.loganalytics.io。実機のMI認証で確認する |
| [Query API応答形式](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/api/response-format) | tables／columns／rows、HTTP 200内のPartialErrorを確認。成功ステータスだけで全件成功にしない |
| [Azure Monitorサービス制限](https://learn.microsoft.com/en-us/azure/azure-monitor/fundamentals/service-limits#query-api) | APIは500,000行、圧縮64 MB／展開後約100 MiB、最大10分。Logsコネクタとは異なる上限 |
| [Query APIタイムアウト](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/api/timeouts) | 既定180秒、最大600秒、Prefer waitで指定。エラー解説には別認証方式の記述もあるためMI直アクセスは実機確認を必須にする |
| [Logic Apps制限](https://learn.microsoft.com/en-us/azure/logic-apps/logic-apps-limits-and-config#http-request-limits) | Standard HTTP送信は既定225秒、通常メッセージ100 MB。API単独の限界まで処理できると仮定しない |
| [Log Analytics保持設定](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/data-retention-configure) | Analytics保持と長期保持を区別。月次抽出の対象期間が通常クエリ可能な範囲に残ることを確認 |
| [VMの既定外向きアクセス](https://learn.microsoft.com/en-us/azure/virtual-network/ip-services/default-outbound-access) | 明示的な送信方式が必要な構成を確認。管理VMのNAT経路を追加 |
| [Bastion概要](https://learn.microsoft.com/en-us/azure/bastion/bastion-overview) | ブラウザー接続とVMのPublic IP不要を確認。Private-onlyは別の閉域到達手段が必要 |

## 11. 改訂で解消した点と残るゲート

- 解消：インターネット障害による資料未確認、通常WSのキー無効化可否、非公開Storage構築時のportalとARMの違い、組み込みBlobのMI対応、診断設定の取り込み経路。
- 方針確定：ASE v3 Windowsを主候補、portalからARM投入、ホストを含むキー認証禁止、NAT候補、Analytics保持90日候補。
- 未解消：初回からキーなし・非公開でASE上のStandardを構築するテンプレートと実機結果、対象契約でのリージョン／SKU／ポリシー適合、具体的な費用・作成承認、本番量。
- 本改訂ではAzureへ接続してのリソース一覧取得、テンプレート投入、デプロイ、ログ抽出は行っていない。

## 12. 実機検証結果（2026-10-19 実施、1回目で成功・計画の変更なし）

環境：RG `rg-poc-lawexport-sea`（Southeast Asia、検証後に削除）。テンプレートは foundation.bicep / ase.bicep / app.bicep、ワークフローは workflow.json（session files配下）。

| 項目 | 結果 |
|---|---|
| ASE v3(内部)作成 | 成功（約数分）。Isolated v2 I1v2、プラン作成のみ約15分 |
| キーなし・非公開でのLogic Apps Standard起動 | **成功**。AzureWebJobsStorage__* のMI設定のみ、ホストStorageはSharedKey無効・PNA無効・PEのみ。ホスト状態Running、ワークフローHealthy |
| 再起動後 | 成功（キー・公開なしで復帰、実行も成功） |
| LAW照会（HTTP+MI、api.loganalytics.azure.com、audience=api.loganalytics.io） | 成功。Private Link経由で名前解決は10.50.1.x |
| サンプルA（datatable：境界・カンマ・引用符・日本語・改行） | 2026-01は期待4件（開始境界含む、終了境界除外）。UTF-8 BOM、CSV引用符正常 |
| 0件月（2025-11） | ヘッダーのみのCSV＋manifest rowCount=0 |
| 2026-02 | 終了境界の次月先頭1件のみ |
| サンプルB（AzureActivity、診断設定） | 直接count=4、CSV/manifest=4で一致 |
| 失敗系（不正KQL／列不一致） | いずれもRun=Failed、2026-01のcurrent.jsonは前回のまま |
| 外部遮断 | 公開側からBlob匿名403、AAD付き403(AuthorizationFailure)、LAW照会はNspValidationFailedError、ASEホスト名は名前解決不可 |
| SharedKey/匿名 | 両Storageとも allowSharedKeyAccess=false, allowBlobPublicAccess=false, PNA=Disabled |
| スケジュール発火 | 1分周期の試験ワークフローが自動発火・成功（月次トリガーは手動Runで検証。実月次発火は未観測） |
| VNet内からのCSV取得 | 管理VM(MI, PE経由)でCSV/manifest/current.jsonを取得 |

計画からの差異・学び：
- ワークフロー配置はSCMが非公開のため、ARMのhostruntime管理API（admin/vfs、workflow management API）経由。portalのデザイナーも同じ経路。
- LAWの動的列は文字列で返るため `json(string(item()?[0]))` で正規化。KQL末尾を `project bag=pack_all()` にし、列は設定COLUMNSで指定。
- Standard_B2sはSEAで容量制限。管理VMはD2as_v7。VMはBastion/NATなしでrun-command検証（Bastionによるブラウザー接続とportalデザイナー画面は未検証）。
- 未検証：実月次スケジュール発火、50万行超の分割、Bastion経由のブラウザー操作、PartialErrorの実発生。

## 13. 再検証：ワークフロー サービスプラン(WS1)（2026-10-20 実施、RG `rg-poc-lawexport-ws-sea`、検証後削除）

構成：WS1（Workflow Standard）＋リージョナルVNet統合(snet-integ, 全送信VNet経由)＋サイトPNA無効。ホストStorageはSharedKey無効・PNA無効・PE(blob/queue/table/file)、MIで接続。**AzureWebJobsStorage接続文字列とWEBSITE_CONTENTAZUREFILECONNECTIONSTRING(コンテンツ共有)は設定せず**、WEBSITE_CONTENTOVERVNET=1のみ。テンプレート：app-ws.bicep。

| 項目 | 結果 |
|---|---|
| キーなしでのWS上の起動 | **成功**（ホストRunning、ワークフローHealthy、再起動後も復帰） |
| 2026-01 / 0件(2025-11) / 2026-02 | ASEと同一のCSV・manifest・境界・BOM・引用符 |
| 失敗系（列不一致／不正KQL） | Failed、current.jsonは前回のまま |
| 外部遮断 | Blob匿名403・AAD付き403、サイトURL(公開)403、両StorageはSharedKey無効・PNA無効 |
| 管理VM(PE経由)からのCSV取得 | 成功 |

差異・注意：
- 公式資料にはWSプランでホストStorageのキー無効化は不可とあるが、**コンテンツ共有を使わないARM構成では起動・実行できた**。ただしこの構成が公式サポート範囲か、portalデザイナー編集・ワークフロー保存・ランタイムのスケール監視を含めて長期安定するかは未確認。コンテンツ共有(Azure Files)はキー必須のため使っていない。
- 設定変更直後の再起動中は管理APIがServiceUnavailableを返す。起動を待って再実行すれば成功。
- 2026-01に想定外の実行が1件多く存在（初回ワークフロー読み込み直後のトリガー発火とみられ、current.jsonは最新に更新）。月次トリガー初回起動時の挙動は本番前に確認すること。
- ASEと比べ固定費は大幅に低い。ASEは不要となる可能性があるが、サポート可否の確認(Microsoftサポート等)を推奨。
