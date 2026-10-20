# 顧客提供資材の保守（提供者向け）

顧客向け入口は [customer/README.md](../customer/README.md)。同フォルダー単体が配布対象です。本書と [scripts/](../scripts/) は顧客の作業手順に含めません。

## 正本と生成物

| 正本 | 生成先 |
|---|---|
| [infra/customer/](../infra/customer/) の 3 段階 Bicep と参照元の [foundation.bicep](../infra/foundation.bicep)、[app-ws.bicep](../infra/app-ws.bicep) | [customer/infra/](../customer/infra/) の ARM JSON |
| [workflow.json](../logicapp/monthly-export/workflow.json) | [workflow.json](../customer/logicapp/monthly-export/workflow.json)、定義本体だけの [definition.json](../customer/logicapp/monthly-export/definition.json) |
| [host.json](../logicapp/host.json)、[connections.json](../logicapp/connections.json) | [customer/logicapp/](../customer/logicapp/) の同名ファイル |
| [settings.json](../settings/settings.json)、[settings-b.json](../settings/settings-b.json) | [sample.json](../customer/settings/sample.json)、[azureactivity.json](../customer/settings/azureactivity.json) |

ARM のパラメーター例と顧客向け Markdown は直接保守します。生成済み JSON を手修正せず、正本を更新して再生成してください。正本の Bicep はリポジトリ外の依存なしでビルドでき、生成された ARM の入れ子テンプレートはすべて同梱です。

提供者の開発環境には Node.js と Bicep CLI が必要です。今回の生成・検証では Node.js 24.16.0 / Bicep 0.41.2 を使用しました。外部 npm パッケージは不要です。**顧客に以下を実行させません。**

```powershell
node .\scripts\build-customer.mjs
node .\scripts\build-customer.mjs --check
node --test .\scripts\customer.test.mjs
```

`--check` は変更を書き込まず、現在の Bicep と元 JSON から得た結果が配布資材と一致するかを検証します。Bicep バージョンが異なる場合、生成メタデータが変わることがあります。同じ版で比較するか、正本と生成物を同時に更新します。ビルド失敗を握り潰さず終了します。

元資材には Storage 名長さの型推論警告（BCP334）と未使用 contentShareMode の警告があります。新しいエラーは許容しません。警告の存在は実デプロイ可否や命名規則の検証を代替しません。

## 更新時の確認

- customer 内のリンクがすべて自己完結すること、実環境 ID / PoC 固有 Storage / ユーザーパス / 資格情報が混ざらないこと。
- サポート未確認、portal 操作未検証、性能・応答検証・排他の不足を隠さないこと。
- ARM の入力と手順の出力転記、設定キー、Blob パス、期待件数が一致すること。
- portal の貼り付け形式と host / connections の配置前提を実機で確認すること。生成時の構文検証だけで portal 完結と表現しないこと。
- 実機検証は専用 RG、サポート確認、構成・費用の個別承認を得てから実施し、RG 外の診断設定等も後片付けすること。
- 検証結果は [docs/plan.md](plan.md) へ日付・構成・結果・差異を追記する。顧客の固有値をコミットしないこと。

既存の PoC 検証スクリプトは配布・再生成に使いません。そこに残る固定名や CLI の成功実績を顧客手順へ移植しないでください。
