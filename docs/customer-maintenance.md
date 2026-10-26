# Consumption 顧客提供資材の保守（提供者向け）

配布対象は [customer/](../customer/) 単独です。本書と [scripts/](../scripts/) は顧客のコマンド実行手順ではありません。顧客は Azure portal のみを使います。

## 顧客向け資料の編集方針

customerには現行Consumptionの構成・3段階導入・ダミーテスト・KQL設定と追加・運用・取得・削除・受入条件だけを記載します。方式比較、旧方式の説明や移行、変更履歴、提供者の試行錯誤・画面トラブル・検証の詳細な時系列を含めません。検討と実測の証拠は[plan.md](plan.md)、実ID付き画像等は非公開ログへ保持します。

受入資料は現行版の確認範囲を短く示し、顧客が記入する合格条件と実行手順を中心にします。未確認の本番KQL・本番量・実月次・独立CSV取得は隠さず、必要な受入条件として残します。customerから配布範囲外の内部資料へリンクしません。

## 正本と生成物

| 正本 | 生成物 |
|---|---|
| [3 段階 Bicep](../infra/customer/) | [customer/infra/](../customer/infra/) の 01-foundation / 02-workflow / 03-access ARM |
| [Consumption 定義](../logicapp/monthly-export/definition.json) | [配布定義](../customer/logicapp/monthly-export/definition.json)。第 2 段階 ARM にも同梱 |
| [settings/](../settings/) の設定 JSON | [customer/settings/](../customer/settings/) の同名 JSON、`KQL_BODY.value` を取り出した `.kql`、`COLUMNS` 配列順の `.csv-columns.json` |

ARM の入力例と Markdown は直接保守します。生成済み定義・ARM を手修正せず、正本を直して再生成してください。外部テンプレートリンクや実環境 ID、ユーザーパス、資格情報を同梱しません。

KQL パターンの正本は sample / azureactivity / azureactivity-failures / azureactivity-summary / perf-cpu-daily の設定 JSON です。改行は JSON の `\n` で保持し、顧客用 `.kql` は生成します。追加・変更時は [顧客向け変更ガイド](../customer/docs/query-patterns.md)の一覧・列・期待値と、`customer.test.mjs` のパターン一覧・応答フィクスチャも更新してください。ハーネスは KQL エンジンではなく、実テーブル用の例では応答を注入して CSV 契約を検査します。KQL の実行結果を保証しません。

CSV は組み込み Table アクションの `inputs.columns`（カスタム列）で順序と値の式を明示します。初回デプロイでは Bicep の `columns` 入力から当該配列を生成し、構築後の列構成変更は顧客が対応する `.csv-columns.json` をアクション定義へ反映します。ワークフローパラメーター内へ式文字列を入れて再評価させる方式や、bag のキー順に依存する自動列推定は使いません。配布定義のダミー用カスタム列と sample の生成配列はテストで一致させます。

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
- 複数KQLは1KQL1ワークフロー、基盤の第1段階を1回だけ、第2・3段階をKQLごとに適用。`workflow().name` でCSV・manifest・currentを分離し、`workflowName` とcurrentの相対pathを整合させる。共用Storage Account内で名前を重複させない。旧版の月直下出力は自動移行しない。プレフィックスはRBAC境界ではない。
- CSV名は用途名・対象月・実行開始時刻JSTで生成。RunStartedUtcを1回だけ取得し、月計算・RunStampJst・OutputNamesへ渡す。CSVとmanifest/currentの参照を同じOutputNamesから生成し、再試行で変えない。CSV名に実行IDは含めず、実行フォルダー末尾には完全なIDを保持して同一秒の衝突を防ぐ。固定のexport.csvを参照する取得処理は移行対象。
- 旧 WS1 のハッシュ・MIME・接続実績を Consumption の実測として転用しない。

## 検証・受入の境界

[顧客の受入確認](../customer/docs/validation.md)には現行の確認範囲と導入先の受入条件だけを記載します。以下は提供者限定の履歴です。2026-10-22 に Consumption の portal 実構築・編集・4 / 0 / 1 件と再実行の保存・実行内読み戻し、列不一致・不正 KQL の失敗を確認しました。これは静的テストや旧 WS1 の結果ではなく今回の実機証拠です。ただし、独立CSV取得までの「portal 完結」とは表現しません。

2026-10-26 に固定列順版も実機確認しました。キー順が異なる bag の4 / 0 / 1件・再実行、ダミー明細4列・集計3列は保存済みCSVの期待値と全バイト一致。カスタム列不整合は SchemaMismatch で保存前に停止しました。実 AzureActivity・顧客の本番KQLの検証とは区別します。

その後追加したPerf例・ワークフロー名別の保存先・JST日時付きCSV名も、2026-10-27に新規専用環境で8ケース（成功7・想定SchemaMismatch1）を実機確認しました。2本・共通StorageでPerfダミーの平均20 / 50、固定3 / 4列、0 / 1件、再実行を確認。再実行時だけ追加した検証専用Blob読み取り3＋Compose 1で、保存済みcurrent・別KQLのcurrent保持・旧CSV保持を照合しました。検証専用アクションは配布正本へ混入させません。Perfの日次binは元クエリと同じUTC区切りで、JSTの月範囲とは別の意味です。実測の行順比較にはorder byを追加しました。

初回 Disabled＋例外の接続は今回成功しました。保存済み current / manifest / CSV と旧 run の独立取得・照合、公開クライアント拒否、権限不足・通信障害、実月次・本番性能は引き続き未確認です。通常のブラウザーは信頼されたサービスの例外を使えないため、CSV 取得に承認済みの別経路が必要です。接続個別の JSON・exports IAM 画面・Query の選択肢表示の確認も残っています。

上記の「独立取得」は操作者の別経路での取得を指します。10/27の保存済みcurrent・旧CSVの追加読み戻しは確認済みですが、これを操作者の独立取得へ読み替えません。初期・終了時Storage設定の一致、2本のDisabled・Runningなしを確認して専用RGと8資源を削除し、成功通知と元URLの再読み込み404を保存しました。RG外に今回作成物はありません。生画像55枚・実IDを含むJSON / CSV・検証ログは非公開フォルダーのみで保管し、Git / customerには入れません。

実機検証は構成・費用・権限の承認後に専用 RG で実施し、削除承認後に RG 外も含め今回作成分のみ削除・残存確認します。2026-10-26 は、復元・Disabledの照合後に portal の選択資源削除で6資源を削除し、成功6・失敗0と一覧0件を確認しました。一時残存した空RGも、再サインイン・ブラウザー共有接続復旧後の再試行で削除できました。RGの削除成功通知と元URL再読み込みの404を確認し、今回の後片付けは完了しています。今回RG外の新規作成はありません。既存 WS1 プランを再利用・変更・削除しません。

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
