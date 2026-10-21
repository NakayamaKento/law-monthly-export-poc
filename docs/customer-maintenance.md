# Consumption 顧客提供資材の保守（提供者向け）

配布対象は [customer/](../customer/) 単独です。本書と [scripts/](../scripts/) は顧客のコマンド実行手順ではありません。顧客は Azure portal のみを使います。

## 正本と生成物

| 正本 | 生成物 |
|---|---|
| [3 段階 Bicep](../infra/customer/) | [customer/infra/](../customer/infra/) の 01-foundation / 02-workflow / 03-access ARM |
| [Consumption 定義](../logicapp/monthly-export/definition.json) | [配布定義](../customer/logicapp/monthly-export/definition.json)。第 2 段階 ARM にも同梱 |
| [settings/](../settings/) の設定 JSON | [customer/settings/](../customer/settings/) の sample / azureactivity |

ARM の入力例と Markdown は直接保守します。生成済み定義・ARM を手修正せず、正本を直して再生成してください。外部テンプレートリンクや実環境 ID、ユーザーパス、資格情報を同梱しません。

## 再生成と検証

Node.js と Bicep CLI を提供者の開発環境で使います。npm 依存追加は不要です。

```powershell
node .\scripts\build-customer.mjs
node .\scripts\build-customer.mjs --check
node --test .\scripts\customer.test.mjs
git --no-pager diff --check
```

`--check` は書き込まず、Bicep の現在のコンパイル結果と配布物を照合します。同じ Bicep バージョンで比較し、バージョン差でメタデータが変わる場合は正本と生成物を一緒に確認します。実デプロイやコネクタの実行は静的テストでは証明できません。

## 移行で守る契約

- Consumption は `Microsoft.Logic/workflows`、システム MI、初期 Disabled。管理接続 2 個は V1。Standard の V2 / host.json / connections.json / `appsetting()` / ServiceProvider を再導入しない。
- 3 段階は新規基盤 → 無効状態のワークフロー・接続 → RBAC。設定・権限が揃うまで有効化しない。
- Storage は初回から PNA Disabled、Deny、AzureServices、Shared Key false、匿名 false、TLS 1.2 / HTTPS。接続失敗時に公開化・キー認証で穴埋めしない。
- exports の Blob Data Contributor と LAW の Log Analytics Reader のみ。ホストロールやユーザー割り当て MI は不要。
- ワークフローのパラメーターに KQL・列・対象月・対象 LAW・Storage 名を置く。ARM が `$connections` を設定し、ユーザーのサインイン・シークレットを不要にする。
- 月境界、4 / 0 / 1 件、列順、BOM、必須 value / bag、異常応答・行数上限、有限再試行、同時実行数 1 を保持する。
- CSV / manifest は run 別、最後に current。読み戻しの応答型・エンコードと、同名 current 更新時の管理コネクタの挙動を検証する。通信失敗時に current 不変を無条件に断言しない。
- 旧 WS1 のハッシュ・MIME・接続実績を Consumption の実測として転用しない。

## 検証・受入の境界

[顧客の受入確認](../customer/docs/validation.md)には Consumption の Azure 実機項目を未実施として記載します。静的テスト成功を「portal 完結」「保存済み CSV 確認済み」と表現しません。

初回 Disabled＋例外の動作、MI 接続の作成と認可、4 / 0 / 1 件の保存・独立読み戻し、異常系、再実行、公開クライアント拒否、portal 編集・実ファイル取得は別途実機確認が必要です。通常のブラウザーは信頼されたサービスの例外を使えないため、CSV 取得に承認済みの別経路が必要です。

実機検証は構成・費用・権限の承認後に専用 RG で実施し、RG 外も含め今回作成分のみ削除・残存確認します。既存 WS1 プランを再利用・変更・削除しません。

## 過去の削除事故を再発させない

旧 WS1 検証では最後のサイト削除に空プランが連動し、保持に失敗して元の宣言で再作成復旧しました。詳しくは [plan.md](plan.md) §19。Consumption 版は App Service プランを作りませんが、別途旧環境を整理するときは [Web Apps Delete](https://learn.microsoft.com/en-us/rest/api/appservice/web-apps/delete?view=rest-appservice-2024-04-01)の `deleteEmptyServerFarm=false`、事前 GET 保全、削除後の直接比較を維持します。汎用リソース削除を旧サイトへ使いません。

## 公開情報

- [MI 認証・Consumption V1 の接続 ARM](https://learn.microsoft.com/en-us/azure/logic-apps/authenticate-with-managed-identity)
- [Blob 管理コネクタの操作・制限](https://learn.microsoft.com/en-us/connectors/azureblobconnector/)
- [Blob のファイアウォール越し接続](https://learn.microsoft.com/en-us/azure/connectors/connectors-create-api-azureblobstorage#access-blob-storage-in-same-region-with-system-managed-identities)
- [Storage の例外の優先関係](https://learn.microsoft.com/ja-jp/azure/storage/common/storage-network-security-limitations)
- [Monitor Logs の操作・MI](https://learn.microsoft.com/en-us/connectors/azuremonitorlogs/)
- [ワークフロー定義のパラメーター](https://learn.microsoft.com/en-us/azure/logic-apps/workflow-definition-language-schema)
- [Bicep のビルド](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/bicep-cli#build)
