# Consumption 導入手順（Azure portal のみ）

[入口](../README.md) → 本書 → [ダミーテスト・受入確認](validation.md) → [運用・削除](operations.md)

## 0. 承認・停止条件

本一式は新規の評価環境用です。2026-10-22 に portal からの構築とダミー CSV の保存・実行内読み戻しを確認しました。独立したファイル取得などの未確認項目は[受入確認](validation.md)を参照し、導入先ごとに次を満たすまで作成しません。

| 確認事項 | 条件 |
|---|---|
| ネットワーク要件 | Storage の Public 拒否と信頼されたサービスの例外の併用を許容。Private Endpoint 必須ではない |
| 認証 | システム割り当て MI。Shared Key / SAS / ユーザー接続の利用不可 |
| 配置・費用 | 専用 RG、Southeast Asia、Storage・LAW・Consumption・接続 2 個と削除範囲を承認 |
| 権限 | リソース作成と、exports / LAW のロール割り当てが可能。[Contributor だけではロール割り当て不可](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/privileged#contributor) |
| 管理 | portal / Entra ID / Azure 管理へのブラウザーアクセス。組織 Policy・リージョン・プロバイダー制限に適合 |
| CSV 取得 | 保存の評価とファイル取得の評価を区別し、[承認済みの取得経路](operations.md#3-csv-の取得と完了判定)を決定 |

Storage の Public network access は初回から **Disabled** にします。例外接続に失敗しても Enabled に変更しません。設定の一時解除を目的とするタグも付けません。

[公式の Blob 手順](https://learn.microsoft.com/en-us/azure/connectors/connectors-create-api-azureblobstorage#access-blob-storage-in-same-region-with-system-managed-identities)は「選択したネットワークから有効」を例示しています。[Disabled 後も例外が有効という説明](https://learn.microsoft.com/ja-jp/azure/storage/common/storage-network-security-limitations)だけで本サンプルの接続成功を保証せず、最優先で受入確認します。

## 1. 評価用 RG と入力の準備

1. Azure portal で対象サブスクリプションを確認し、承認された**専用リソースグループ**を新規作成する。既存のプランや本番資源を再利用しない。
2. リソース名、作成者、費用承認、削除対象、作業前の資源一覧を顧客台帳へ記録する。
3. 各段階で **カスタム テンプレートのデプロイ → エディターで独自のテンプレートを作成する**を開き、対象 ARM JSON の全文を貼り付けて保存する。入力例は参考で、`<...>` を残したまま投入しない。
4. **確認と作成**で検証結果を確認する。失敗したら詳細を保全して停止する。CLI / Cloud Shell に切り替えない。

実機トレースでは「ファイルの読み込み」が portal のエラーになったため、上記の全文貼り付けで完了しました。空の既定テンプレートのまま進めず、貼り付けたリソース・パラメーターが表示されたことを確認してください。

公式：[portal から ARM テンプレートをデプロイ](https://learn.microsoft.com/en-us/azure/azure-resource-manager/templates/deploy-portal)。

## 2. 第 1 段階：Storage と評価用 LAW

[01-foundation.json](../infra/01-foundation.json) と [入力例](../infra/01-foundation.parameters.json)を使用します。

| ARM 入力 | 内容 |
|---|---|
| location | 承認済みリージョン（例 `southeastasia`） |
| prefix | Storage / LAW の名前生成用プレフィックス。入力欄の文字数・文字種制限に従う |
| retentionInDays | LAW の保持日数。例は 90 日。課金・保持を承認してから指定 |

1. 専用 RG と承認されたリージョンを選ぶ。名前の一意性・文字数制限に従って入力する。
2. デプロイ成功後、**出力**の Storage 名・LAW 名・リソース ID を台帳へ控える。次の段階に同じ値を転記する。
3. Storage → **ネットワーク**と **構成**で次を確認する。

   | 設定 | 必須値 |
   |---|---|
   | Public network access | Disabled |
   | 既定ネットワーク動作 | Deny |
   | 信頼されたサービス一覧の Azure サービスによるアクセス | 許可（AzureServices） |
   | ストレージ アカウント キーへのアクセスを許可 | 無効 |
   | Blob 匿名アクセス | 無効 |
   | 安全な転送 / 最小 TLS | 必須 / 1.2 |

4. LAW の公開クエリは有効、公開取り込みは無効であることを確認する。ダミー KQL の実行にログ取り込みは不要。

出力名は `storageAccountName` / `lawName` / `lawResourceId` / `exportsContainerResourceId` です。

Storage ブラウザーでデータが見えないことを、コンテナーの作成失敗と即断しません。管理プレーンでのコンテナー存在確認と、データプレーンのアクセスは別です。

## 3. 第 2 段階：Consumption と管理接続

[02-workflow.json](../infra/02-workflow.json) と [入力例](../infra/02-workflow.parameters.json)を使用します。

| ARM 入力 | 内容 |
|---|---|
| location | 第 1 段階と同じリージョン |
| workflowName | 新規 Consumption の名前 |
| storageAccountName / lawName | 第 1 段階の同名出力 |
| startTime | 初回の承認済み JST 日時（以下の例参照） |
| columns / kqlBody / monthOverride | ダミー評価用の値は入力例に同梱。columns は文字列配列、kqlBody は文字列。通常運用へ自動移行しない |

1. 第 1 段階と同じ RG・リージョンとし、Storage / LAW の名前・ID を入力する。
2. ワークフロー名を決める。管理接続名はテンプレートがワークフロー名から生成する。既存の資源と衝突する名前を使わない。
3. 開始日時には、例えば **`2026-12-05T09:00:00`** をコピーする。これは **2026 年 12 月 5 日 09:00 JST**。実施時点で少なくとも 1 か月先の、承認済みの月の 5 日 09:00 に変更する。末尾 **Z / +09:00 は付けず**、timeZone は **Tokyo Standard Time** を維持する。
4. デプロイする。Logic App は**無効状態**で作成される。第 3 段階を終えるまで有効化しない。
5. Logic App → **ID**でシステム割り当てが有効であることを確認し、プリンシパル ID を台帳へ控える。
6. **API 接続**に Monitor Logs と Blob の 2 個があることを確認する。認証は **Logic Apps Managed Identity / マネージド ID**。ユーザーによるサインインやキー入力を要求されたら、その方法で認可せず停止する。

出力は `workflowName` / `workflowResourceId` / `workflowPrincipalId` / `monitorConnectionId` / `blobConnectionId`。台帳と実リソースの ID が一致することを確認します。

Consumption では Storage の組み込みコネクタではなく Blob **管理**コネクタを使います。接続の ARM は V1、ワークフロー参照は `$connections` です。host.json、connections.json のファイル配置、WS1、VNet 統合の作成は不要です。

公式：[Consumption の portal 管理](https://learn.microsoft.com/en-us/azure/logic-apps/quickstart-create-example-consumption-workflow)、[MI 認証と接続 ARM](https://learn.microsoft.com/en-us/azure/logic-apps/authenticate-with-managed-identity)、[Recurrence の初回実行](https://learn.microsoft.com/en-us/azure/connectors/connectors-native-recurrence)。

## 4. 第 3 段階：アプリ MI の権限

[03-access.json](../infra/03-access.json) と [入力例](../infra/03-access.parameters.json)を使用します。

1. ARM 入力の `workflowName` / `storageAccountName` / `lawName` に第 1・2 段階の名前を正確に転記する。プリンシパル ID はテンプレートがワークフローから取得するため、入力しない。
2. デプロイ後、**exports コンテナー**の IAM でその MI に **Storage Blob Data Contributor**、LAW の IAM で **Log Analytics Reader**があることを確認する。
3. Storage アカウント全体の Blob Data Owner、Queue / Table のロール、ホスト用 ID は追加しない。
4. RBAC の反映を待つ。接続エラー時は反映・対象・スコープを確認し、ネットワーク制限を解除しない。

出力の `blobRoleAssignmentId` / `lawRoleAssignmentId` を台帳に控え、実際の割り当て先が第 2 段階の `workflowPrincipalId` と一致することを確認します。

公式：[Blob データのロール割り当て](https://learn.microsoft.com/en-us/azure/storage/blobs/assign-azure-role-data-access)。

## 5. パラメーターと保存内容の確認

Logic App の **パラメーター**、または **ロジック アプリ コード ビュー**で定義と値を確認します。画面名は portal の版で異なります。`definition.parameters` は型・既定値、外側の `parameters` は設定値です。部分 JSON で定義全体や `$connections` を消さないでください。

2026-10-22 の画面では **開発ツール → ロジック アプリ コード ビュー**から編集し、**Publish** で反映しました。**Draft の自動保存だけでは公開済みの値を更新したと判定しません。** 変更前の全文を控え、外側の `parameters.<名前>.value` を変更します。保存・Publish 後は概要の有効状態も再確認し、評価を実行する直前までは Disabled に戻します。

| ワークフローパラメーター | 用途 |
|---|---|
| LAW_RESOURCE_ID | LAW の ARM リソース ID。ワークスペース GUID ではない |
| STORAGE_ACCOUNT_NAME | 出力 Storage のアカウント名。URL やコンテナー名ではない |
| MONTH_OVERRIDE | 試験時 `2026-01`、通常月次は空文字 |
| COLUMNS | **配列**。ダミー時 `["TimeGenerated","Id","Text"]`。カンマ区切りの 1 文字列にしない |
| KQL_BODY | [ダミー設定](../settings/sample.json)の KQL。`start` / `end` 宣言はワークフローが付加 |
| $connections | ARM が生成する 2 接続の参照。手動で消さない |

開始日時はワークフローパラメーターではなく、トリガーの `recurrence.startTime` に設定されます。`START_TIME` パラメーターは追加しません。

1. Query の **Time Range Type** を **Set in query / クエリで設定**として確認する。配布定義の内部値は `"3"`、timerange は `{}`。この内部値は旧接続メタデータに基づくため、Consumption のデザイナーでも表示・保存内容が対応することを受入確認する。
2. Blob の V2 操作のアカウント名はカスタム値として指定される。キー認証へ変更しない。
3. ワークフローが無効、Recurrence が承認した将来日時、同時実行数が 1 であることを確認する。
4. [ダミーテスト](validation.md#2-実データ不要のダミーテスト)へ進む。接続や画面操作が成立しない場合は未達として記録し、停止する。

ダミー評価後は無効化します。本番運用にするには実テーブルの KQL・列・遅延取り込み・保持・容量を承認し、MONTH_OVERRIDE を空にして、次回予定を確認したうえで有効化してください。ダミーのまま自動運用へ移行しません。

本番 KQL の準備・変更は [KQL パターンの変更](query-patterns.md)に従います。明細・失敗のみ・操作別集計の貼り付け用 KQL と対応する列を同梱しています。期間計算は変更せず、`KQL_BODY` と `COLUMNS` を差し替えます。CSV の列順はカスタム列で固定します。初回 ARM は入力 `columns` からカスタム列も生成しますが、構築後に列構成を変更する場合は `Create_CSV_table` のカスタム列も対応する `.csv-columns.json` で更新します。
