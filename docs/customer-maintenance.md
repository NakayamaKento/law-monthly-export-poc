# 顧客提供資材の保守（提供者向け）

顧客向け入口は [customer/README.md](../customer/README.md)。同フォルダー単体が配布対象です。本書と [scripts/](../scripts/) は顧客の作業手順に含めません。

## 正本と生成物

| 正本 | 生成先 |
|---|---|
| [infra/customer/](../infra/customer/) の 3 段階 Bicep と参照元の [foundation.bicep](../infra/foundation.bicep)、[app-ws.bicep](../infra/app-ws.bicep) | [customer/infra/](../customer/infra/) の ARM JSON |
| [workflow.json](../logicapp/monthly-export/workflow.json) | [workflow.json](../customer/logicapp/monthly-export/workflow.json)、定義本体だけの [definition.json](../customer/logicapp/monthly-export/definition.json) |
| [host.json](../logicapp/host.json)、[connections.json](../logicapp/connections.json) | [customer/logicapp/](../customer/logicapp/) の同名ファイル |
| [settings.json](../settings/settings.json)、[settings-b.json](../settings/settings-b.json) | [sample.json](../customer/settings/sample.json)、[azureactivity.json](../customer/settings/azureactivity.json) |
| [settings.json](../settings/settings.json) | 提供者向け [settings-ws.json](../settings/settings-ws.json) も同時生成し、旧 LAW_ID 設定との食い違いを防ぐ |

ARM のパラメーター例と顧客向け Markdown は直接保守します。生成済み JSON を手修正せず、正本を更新して再生成してください。正本の Bicep はリポジトリ外の依存なしでビルドでき、生成された ARM の入れ子テンプレートはすべて同梱です。

提供者の開発環境には Node.js と Bicep CLI が必要です。今回の生成・検証では Node.js 24.16.0 / Bicep 0.41.2 を使用しました。外部 npm パッケージは不要です。**顧客に以下を実行させません。**

```powershell
node .\scripts\build-customer.mjs
node .\scripts\build-customer.mjs --check
node --test .\scripts\customer.test.mjs
```

`--check` は変更を書き込まず、現在の Bicep と元 JSON から得た結果が配布資材と一致するかを検証します。Bicep バージョンが異なる場合、生成メタデータが変わることがあります。同じ版で比較するか、正本と生成物を同時に更新します。ビルド失敗を握り潰さず終了します。

元資材には Storage 名長さの型推論警告（BCP334）と未使用 contentShareMode の警告があります。[MI 管理コネクタの公式 ARM 例](https://learn.microsoft.com/en-us/azure/logic-apps/authenticate-with-managed-identity)で必要な `kind: V2` / `parameterValueSet` / `connectionRuntimeUrl` と accessPolicies は Bicep の型定義不足による BCP187 / BCP089 / BCP053 / BCP081 警告が出ます。診断コードの意味は [Bicep の警告・エラー一覧](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/bicep-core-diagnostics)を参照してください。型警告を避けるための any キャストは追加していません。新しいエラーは許容しません。警告の存在は実デプロイ可否の検証を代替しませんが、2026-10-21 に全 3 段階の Azure validate / what-if / 実投入が成功しています。

共有基盤の既定 `hostingMode=ase` / `privateLogAnalytics=true` / `separateOutputStorage=true` は旧 PoC のリソース構成を保持します。顧客版だけ `ws` / `false` / `false` を固定指定し、Storage 1 個、Blob / Queue / Table PE 3 個、サイト PE 1 個、DNS 4 ゾーン、サブネット 2 個にします。LAW の公開クエリは有効、公開取り込みは無効です。条件を満たさない出力 Storage / PE と AMPLS 一式は作成しません。旧環境へ基盤を再投入して削除する目的には使いません。

ワークフロー正本と connections.json は Blob 組み込み / Monitor Logs 管理コネクタへ変更済みです。第 3 段階で V2 API 接続 1 個とアプリ MI のアクセスポリシーを作成し、Blob ロールは exports スコープに限定します。全 8 アプリ設定を接続 JSON も含めて照合し、HTTP アクションがないこと、value / bag の必須検証、トリガー同時実行数 1、既存の出力パス・BOM・ダミー境界を静的検証します。

実機で `POST /getTimeRangeTypes` を呼び、「Set in query」の `timerangetype` は `"3"` と確認しました。Blob の正式な接続パラメーターは `blobStorageEndpoint` / `managedIdentityType: SystemAssigned`、Monitor Logs MI の接続プロパティには `additionalAudiences: ["https://api.loganalytics.io"]` が必要でした。追加 audience がないとメタデータ取得だけは成功しても Query は Token not found で失敗します。実ホストの Blob 操作メタデータと [Microsoft の接続生成実装](https://github.com/Azure/LogicAppsUX/blob/main/libs/designer/src/lib/core/actions/bjsworkflow/connections.ts)を照合して正本・配布物・テストを更新しています。公開実装は公式のサポート保証とは区別してください。

同じ版でダミーの 4 件・0 件・1 件の保存を実行し、組み込み readBlob で current / manifest / CSV を独立読み戻しして内容・BOM・MD5 を確認しました。CSV / JSON の保存 MIME は `text/plain; charset=utf-8` で、旧 HTTP 版とは異なります。実機の詳細は [plan.md](plan.md) §19、顧客向けの検証値は[受入確認](../customer/docs/validation.md)を参照してください。portal の接続 JSON 編集・保存は未実証です。旧 ASE 閉域 LAW の操作記録に現行ワークフローをそのまま適用しないでください。

## 更新時の確認

- customer 内のリンクがすべて自己完結すること、実環境 ID / PoC 固有 Storage / ユーザーパス / 資格情報が混ざらないこと。
- サポート未確認、portal 操作未検証、性能・応答検証・排他の不足を隠さないこと。
- ARM の入力と手順の出力転記、設定キー、Blob パス、期待件数が一致すること。
- portal の貼り付け形式と host / connections の配置前提を実機で確認すること。生成時の構文検証だけで portal 完結と表現しないこと。
- 実機検証は専用 RG、サポート確認、構成・費用の個別承認を得てから実施し、RG 外の診断設定等も後片付けすること。
- 検証結果は [docs/plan.md](plan.md) へ日付・構成・結果・差異を追記する。顧客の固有値をコミットしないこと。

## 既存プランを再利用する検証の削除事故防止

2026-10-21 の検証では、サイトの汎用 `az resource delete` により、最後のアプリとともに保持予定の空 WS1 プランも削除された。対象 ID の除外リストだけではプロバイダーの連動削除を防げなかった。元のデプロイと完全一致するプラン宣言だけを検証・再投入し、同一 ID・リージョン・WS1・kind・最大ワーカー数・アプリ 0 件・Ready を確認して復旧したが、元のリソースを無変更で保持できたという結果ではない。

[Web Apps Delete の公式仕様](https://learn.microsoft.com/en-us/rest/api/appservice/web-apps/delete?view=rest-appservice-2024-04-01)は、空プランを保持するには **`deleteEmptyServerFarm=false`** を指定し、既定では削除されると記載している。提供者が管理 API でサイトを削除する場合は、この値を必ず明示し、汎用リソース削除を使わない。顧客の portal 手順では関連プランを含めないこと・保持を明示できなければ停止することを記載する。

作成前にプランの GET 本文・設定・タグと既存資源一覧を私有の検証記録へ保全し、終了後は一覧だけでなくプラン本体の GET も比較する。既存 RG を丸ごと削除しない。予期しない差異は成功扱いにせず、操作履歴を保全してユーザーへ報告する。この注意点はリポジトリの作業指示と顧客の削除手順にも反映した。

既存の PoC 検証スクリプトは配布・再生成に使いません。そこに残る固定名や CLI の成功実績を顧客手順へ移植しないでください。
