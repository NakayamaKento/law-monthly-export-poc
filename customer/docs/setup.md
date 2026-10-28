# Consumption 導入手順（Azure portal のみ）

[入口](../README.md) → 本書 → [ダミーテスト・受入確認](validation.md) → [運用・削除](operations.md)

## 0. 承認・停止条件

本一式は新規の評価環境用です。導入先ごとに次の条件を確認し、承認を得てから作成します。本番利用の条件は[受入確認](validation.md)を参照してください。

| 確認事項 | 条件 |
|---|---|
| ネットワーク要件 | Storage の Public 拒否と信頼されたサービスの例外の併用を許容。Private Endpoint 必須ではない |
| 認証 | システム割り当て MI。Shared Key / SAS / ユーザー接続の利用不可 |
| 配置・費用 | 専用 RG、Southeast Asia、Storage・Consumption・接続 2 個と削除範囲を承認。既存 LAW の利用も承認 |
| 権限 | リソース作成、exports / LAW のロール割り当てが可能。[Contributor だけではロール割り当て不可](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/privileged#contributor) |
| 取得元 LAW | 利用を承認された既存 workspace、クエリ有効、Analytics プラン、MI への Log Analytics Reader 付与が可能 |
| 管理 | portal / Entra ID / Azure 管理へのブラウザーアクセス。組織 Policy・リージョン・プロバイダー制限に適合 |
| CSV 取得 | 保存の評価とファイル取得の評価を区別し、[承認済みの取得経路](operations.md#3-csv-の取得と完了判定)を決定 |

Storage の Public network access は初回から **Disabled** にします。例外接続に失敗しても Enabled に変更しません。設定の一時解除を目的とするタグも付けません。

信頼されたサービスの例外とMIの権限は別条件です。[BlobのシステムMI接続](https://learn.microsoft.com/en-us/azure/connectors/connectors-create-api-azureblobstorage#access-blob-storage-in-same-region-with-system-managed-identities)と[Storageのネットワーク制限](https://learn.microsoft.com/ja-jp/azure/storage/common/storage-network-security-limitations)を確認し、構築後はダミーテストで接続を受入確認します。

## 1. 評価用 RG と入力の準備

1. Azure portal で対象サブスクリプションを確認し、承認された**専用リソースグループ**を新規作成する。既存のプランや本番資源を再利用しない。
2. リソース名、作成者、費用承認、削除対象、作業前の資源一覧を顧客台帳へ記録する。
3. 各段階で **カスタム テンプレートのデプロイ → エディターで独自のテンプレートを作成する**を開き、対象 ARM JSON の全文を貼り付けて保存する。入力例は参考で、`<...>` を残したまま投入しない。
4. **確認と作成**で検証結果を確認する。失敗したら詳細を保全して停止する。CLI / Cloud Shell に切り替えない。

空の既定テンプレートのまま進めず、貼り付けたリソース・パラメーターが表示されたことを確認してください。

公式：[portal から ARM テンプレートをデプロイ](https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deploy-portal)。

## 2. 既存 LAW の選定と第 1 段階：Storage

1. 利用対象として承認された既存 Log Analytics workspace を選ぶ。Basic / Auxiliary プランは Monitor Logs コネクタの対象外です。対象テーブル・データ・保持期間・クエリ権限も確認します。
2. workspace の **概要 / Properties** で **Resource ID** をコピーして台帳に記録する。Workspace ID (GUID) ではなく、`/subscriptions/.../resourceGroups/.../providers/Microsoft.OperationalInsights/workspaces/...` 形式の ARM リソース ID を使います。
3. workspace の **ネットワーク分離 / Network isolation** で **Public network access for query** が有効であることを確認する。無効、または確認できない場合は既存 LAW の設定を無断変更せず停止し、管理者へ確認する。取り込みはこのサンプルの実行に不要です。

[01-foundation.json](../infra/01-foundation.json) と [入力例](../infra/01-foundation.parameters.json)を使用します。この段階では Storage と `exports` のみを作成し、既存 LAW は作成・変更しません。

| ARM 入力 | 内容 |
|---|---|
| location | 承認済みリージョン（例 `southeastasia`） |
| prefix | Storage 名生成用プレフィックス。入力欄の文字数・文字種制限に従う |

1. 専用 RG と承認されたリージョンを選ぶ。名前の一意性・文字数制限に従って入力する。
2. デプロイ成功後、**出力**の Storage 名・exports コンテナーのリソース ID を台帳へ控える。既存 LAW の ARM リソース ID は上記で記録したものを使用する。
3. Storage → **ネットワーク**と **構成**で次を確認する。

   | 設定 | 必須値 |
   |---|---|
   | Public network access | Disabled |
   | 既定ネットワーク動作 | Deny |
   | 信頼されたサービス一覧の Azure サービスによるアクセス | 許可（AzureServices） |
   | ストレージ アカウント キーへのアクセスを許可 | 無効 |
   | Blob 匿名アクセス | 無効 |
   | 安全な転送 / 最小 TLS | 必須 / 1.2 |

4. 既存 LAW の設定を変更していないことを確認する。

出力名は `storageAccountName` / `exportsContainerResourceId` です。LAW の設定や保持期間は本 ARM から出力・変更されません。

Storage ブラウザーでデータが見えないことを、コンテナーの作成失敗と即断しません。管理プレーンでのコンテナー存在確認と、データプレーンのアクセスは別です。

## 3. 第 2 段階：Consumption と管理接続

[02-workflow.json](../infra/02-workflow.json) と [入力例](../infra/02-workflow.parameters.json)を使用します。

| ARM 入力 | 内容 |
|---|---|
| location | 第 1 段階と同じリージョン |
| workflowName | 新規 Consumption の名前兼KQL識別名。同じStorage Accountを使う全ワークフローで一意にする。Blob名の先頭にも使う |
| storageAccountName | 第 1 段階の出力 |
| lawResourceId | §2で確認した既存 workspace の ARM リソース ID。Workspace ID (GUID) ではない |
| startTime | 初回の承認済み JST 日時（以下の例参照） |
| columns / kqlBody / monthOverride | ダミー評価用の値は入力例に同梱。columns は文字列配列、kqlBody は文字列。評価後の本番設定は別途行う |

1. 第 1 段階と同じ RG・リージョンとし、Storage 名と既存 LAW の ARM リソース ID を入力する。
2. ワークフロー名を決める。管理接続名はテンプレートがワークフロー名から生成する。既存の資源と衝突する名前を使わない。
3. 開始日時には、例えば **`2026-12-05T09:00:00`** をコピーする。これは **2026 年 12 月 5 日 09:00 JST**。実施時点で少なくとも 1 か月先の、承認済みの月の 5 日 09:00 に変更する。末尾 **Z / +09:00 は付けず**、timeZone は **Tokyo Standard Time** を維持する。
4. デプロイする。Logic App は**無効状態**で作成される。第 3 段階を終えるまで有効化しない。
5. Logic App → **ID**でシステム割り当てが有効であることを確認し、プリンシパル ID を台帳へ控える。
6. **API 接続**に Monitor Logs と Blob の 2 個があることを確認する。認証は **Logic Apps Managed Identity / マネージド ID**。ユーザーによるサインインやキー入力を要求されたら、その方法で認可せず停止する。

出力は `workflowName` / `workflowResourceId` / `workflowPrincipalId` / `monitorConnectionId` / `blobConnectionId`。台帳と実リソースの ID が一致することを確認します。

Monitor LogsとBlobはMI認証の**管理コネクタ**です。接続はテンプレートが作成し、ワークフローの `$connections` に設定します。

公式：[Consumption の portal 管理](https://learn.microsoft.com/en-us/azure/logic-apps/quickstart-create-example-consumption-workflow)、[MI 認証と接続 ARM](https://learn.microsoft.com/en-us/azure/logic-apps/authenticate-with-managed-identity)、[Recurrence の初回実行](https://learn.microsoft.com/en-us/azure/connectors/connectors-native-recurrence)。

## 4. 第 3 段階：Storage 権限と既存 LAW の権限

[03-access.json](../infra/03-access.json) と [入力例](../infra/03-access.parameters.json)を使用します。

1. ARM 入力の `workflowName` / `storageAccountName` に第 1・2 段階の名前を正確に転記する。プリンシパル ID はテンプレートがワークフローから取得するため、入力しない。
2. ARM をデプロイする。**exports コンテナー**の IAM にその MI の **Storage Blob Data Contributor** が作成されます。Storage アカウント全体へ権限を広げない。
3. Logic App の **ID** でシステム割り当て MI のプリンシパル ID を確認する。
4. §2で選んだ既存 LAW を開き、**アクセス制御 (IAM) → ロール割り当ての追加**で **Log Analytics Reader** を選択する。**マネージド ID** を選び、今回の Logic App を指定して割り当てる。既存 LAW の権限を変更する承認と、対象 LAW スコープでのロール割り当て権限が必要です。
5. LAW の IAM で対象 Logic App の MI に **Log Analytics Reader**、exports コンテナーの IAM で同じ MI に **Storage Blob Data Contributor** があることを確認する。RBAC の反映を待ちます。接続エラー時は対象・スコープ・反映を確認し、ネットワーク制限を解除しません。

出力の `blobRoleAssignmentId` と LAW の IAM 画面の割り当て先を台帳に控えます。どちらも第 2 段階の `workflowPrincipalId` と一致することを確認します。

公式：[Blob データのロール割り当て](https://learn.microsoft.com/en-us/azure/storage/blobs/assign-azure-role-data-access)。

## 5. パラメーターと保存内容の確認

Logic App の **パラメーター**、または **ロジック アプリ コード ビュー**で定義と値を確認します。画面名は portal の版で異なります。`definition.parameters` は型・既定値、外側の `parameters` は設定値です。部分 JSON で定義全体や `$connections` を消さないでください。

**開発ツール → ロジック アプリ コード ビュー**で変更する場合は、変更前の全文を控え、外側の `parameters.<名前>.value` を編集して **Publish** します。**Draftの自動保存だけでは反映完了としません。** 公開成功と再表示した値を確認し、試験直前までDisabledを維持します。

| ワークフローパラメーター | 用途 |
|---|---|
| LAW_RESOURCE_ID | LAW の ARM リソース ID。ワークスペース GUID ではない |
| STORAGE_ACCOUNT_NAME | 出力 Storage のアカウント名。URL やコンテナー名ではない |
| MONTH_OVERRIDE | 試験時 `2026-01`、通常月次は空文字 |
| COLUMNS | **配列**。ダミー時 `["TimeGenerated","Id","Text"]`。カンマ区切りの 1 文字列にしない |
| KQL_BODY | [ダミー設定](../settings/sample.json)の KQL。`start` / `end` 宣言はワークフローが付加 |
| $connections | ARM が生成する 2 接続の参照。手動で消さない |

開始日時はワークフローパラメーターではなく、トリガーの `recurrence.startTime` に設定されます。`START_TIME` パラメーターは追加しません。

1. Query の **Time Range Type** が **Set in query / クエリで設定**であることを確認する。配布定義の内部値は `"3"`、timerange は `{}`。KQL本文のstart / endで期間を指定する。
2. Blob の V2 操作のアカウント名はカスタム値として指定される。キー認証へ変更しない。
3. ワークフローが無効、Recurrence が承認した将来日時、同時実行数が 1 であることを確認する。
4. [ダミーテスト](validation.md#2-実データ不要のダミーテスト)へ進む。接続や画面操作が成立しない場合は未達として記録し、停止する。

ダミー評価後は無効化します。本番運用にするには実テーブルの KQL・列・遅延取り込み・保持・容量を承認し、MONTH_OVERRIDE を空にして、次回予定を確認したうえで有効化してください。ダミーのまま自動運用へ移行しません。

本番 KQL の準備・変更は [KQL パターンの変更](query-patterns.md)に従います。明細・失敗のみ・操作別集計の貼り付け用 KQL と対応する列を同梱しています。期間計算は変更せず、`KQL_BODY` と `COLUMNS` を差し替えます。CSV の列順はカスタム列で固定します。初回 ARM は入力 `columns` からカスタム列も生成しますが、構築後に列構成を変更する場合は `Create_CSV_table` のカスタム列も対応する `.csv-columns.json` で更新します。

## 6. 同じStorage Accountへ複数KQLを出力する

**第1段階は1回だけ、第2・3段階はKQLごと**に実施します。同じStorageと既存LAWを共用し、`workflowName` は用途別の一意な名前にします。1つのStorage Account・exportsコンテナーを共用し、追加のStorage Accountは作りません。2本目に1本目と同じ `workflowName` を指定すると既存ワークフローを上書きするため停止してください。

保存先は `exports/<workflowName>/<YYYY-MM>/runs/<実行日時JST>_<run-id>/`、CSV名は `<workflowName>_<対象月>_<実行日時JST>.csv`、currentは `exports/<workflowName>/<YYYY-MM>/current.json` です。CSV名に実行IDは入れず、実行フォルダーには同一秒の衝突防止用として残します。各ワークフローに別のシステムMI・管理接続2個・ロール2個が必要です。追加KQLの入力シート（ARM入力と作成後のパラメーターの対応）、メモリKQLの追加例、Perfの日次CPU平均、列設定、実データなしの試験は [KQLカスタマイズ手順 §5](query-patterns.md#5-複数kqlを1つのstorage-accountへ保存する)を参照してください。用途名はworkflowNameで指定し、Blobアクションの手修正は不要です。

各ワークフローのダミーテストと、KQL間で保存先・currentが分かれることを[受入確認](validation.md)に記録します。
