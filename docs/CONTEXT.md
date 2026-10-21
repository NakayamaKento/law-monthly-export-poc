# プロジェクトコンテキスト（経緯・決定事項・制約）

このファイルは、これまでの議論をリポジトリに引き継ぐためのものです。設計と検証の詳細は [plan.md](plan.md) を参照してください。

## 1. 目的
お客様環境で、Azure Log Analytics のログを**月次で CSV にエクスポート**する作業を自動化する。現在は手作業。

## 2. お客様側の制約（変更不可）
- Azure 環境へアクセスできる端末は限られ、その端末には Az PowerShell や Azure CLI を入れられない。**ローカルでのコマンド実行は不可**。
- 運用担当者は高度な開発が得意ではない。**portal だけで運用できること**。
- **Storage のネットワーク設定で Public を拒否すること**が要件。2026-10-21 に、従来の「閉域化」という表現は Private Endpoint 経由を必須とする意味ではないと明確化された。信頼されたサービスの例外と MI を使う Consumption 案を再検討する。Public network access を Disabled に維持する案を検証対象とし、一時的な公開有効化を前提にしない。**同日の指示で Log Analytics は閉域対象外**。LAW の問い合わせは MI 認証による公開 HTTPS API を許可し、取り込みの公開化は不要なので無効のまま。
- CSV 形式で保管する。保存先は非公開の Blob。
- **キー認証は不可**（ホスト用 Storage を含む）。共有キー無効、マネージド ID を使う。
- 自動化専用の VM は不可。
- 優先順位: Logic Apps または Automation Account を優先し、Azure Functions はなるべく使わない。

## 3. PoC で合意した条件
- リージョンは Southeast Asia、新規環境。VPN などの接続は PoC では使わない。
- Entra ID と Azure 管理系の送信通信は許可。当初はデータ通信を Private Endpoint 経由としたが、現在の Storage 要件は §2 の明確化を優先する。
- 一時的な管理 VM（Bastion 利用可）と NAT Gateway は許可。
- AzureActivity の診断設定による取り込み（Microsoft のプライベート経路）はサンプル用の例外として許可。
- デプロイは ARM テンプレート（portal のカスタムデプロイ）を想定。
- 固定費のある構成は可。本番デプロイ前に費用の承認を取る。
- 検証環境は検証後に必ず削除する。失敗したら、その環境だけ削除して計画を見直してやり直す。キー認証やパブリックアクセスの有効化に逃げない。

## 4. 検討結果と決定事項
| 候補 | 判断 | 理由 |
|---|---|---|
| Automation Account | 不採用 | クラウドジョブはプライベートエンドポイント保護の Storage に届かず、Hybrid Runbook Worker（実行 VM）が必要。VM 不可の制約に反する。[Private Link と Runbook の制約](https://learn.microsoft.com/en-us/azure/automation/how-to/private-link-security)を参照 |
| Azure Functions | 比較のみ | 優先度が低い |
| **Logic Apps Standard** | 既存の配布・PoC | Blob 組み込み / Monitor Logs 管理コネクタ + MI による評価版。単一 Storage での実行・保存済み CSV 読み戻しに成功。portal 実機受入と公式サポートは未確認 |
| **Logic Apps Consumption** | **再検討の第一候補** | システム MI と Blob 管理コネクタ、Storage の信頼されたサービスの例外を利用。ホスト用 Storage・WS1・実行用 VNet / PE / DNS を不要にする案。初回から Public 無効での接続、CSV 取得、portal 完結は未検証。詳細は [plan.md](plan.md) §21 |

当初の LAW 閉域要件では、組み込み HTTP で公開 Query API の Private Link 経路を使う方針とした。LAW を閉域対象外にした後、ユーザーの保守性優先の指示により、現行正本は **Azure Monitor Logs 管理コネクタ**へ変更。Blob は **組み込み**で保存し、REST API の直書きをなくす。管理版には応答約 16 MiB・クエリ最大 100 秒の制限がある。旧 HTTP 版・旧 ASE の実績は新構成の動作証明ではない。

## 5. 実機検証の結果（概要）
過去の詳細は [plan.md](plan.md) の §12・§13。以下の 2 構成とも成功し、旧検証環境は削除済み。最新の単一 Storage・コネクタ版は §19 を参照。

| 構成 | 結果 |
|---|---|
| 内部 ASE v3 + Isolated v2 + Logic Apps Standard | キーなし・非公開で起動・実行・再起動後の復帰まで成功 |
| Workflow Service Plan (WS1) + VNet 統合 + サイト公開なし | 同様に成功。接続文字列とコンテンツ共有を設定せず、`AzureWebJobsStorage__*` の ID 設定のみ。固定費は ASE より大幅に低い |

共通の確認結果:
- 月境界（日本時間の月を UTC に換算し、開始を含み終了を除く）、0 件月（ヘッダーのみ）、特殊文字（カンマ・引用符・日本語・改行）、UTF-8 BOM が期待どおり。
- AzureActivity の実ログで、直接 count と CSV の件数が一致。
- 失敗系（不正 KQL、列不一致）は Failed になり、`current.json` は前回のまま。
- 外部からの Blob・Log Analytics・サイトへのアクセスは拒否。VNet 内の管理 VM からは取得できる。

## 6. 注意点・未解決事項
- **Consumption 案への再検討（2026-10-21）**: Storage の Public 拒否と Private Endpoint 必須を同一視しない。Consumption + システム MI + Blob 管理コネクタの例外経路は公式資料にあるが、Blob の手順は「選択したネットワークから有効」を例示し、Storage 側は Disabled 後も既存例外が有効と説明する。**初回作成から Disabled + AzureServices で CSV 保存・読み戻しできるかは未検証**。失敗時に Public を有効化して回避しない。現在の配布資材は WS1 のままで、その実績を Consumption に流用しない。従来資料に含めた Logic App 自体の非公開化の要否と、操作者の CSV 取得経路は別途整理する。公開根拠と検証条件は [plan.md](plan.md) §21。
- **最新の最小化・組み込み化（2026-10-21）**: 顧客版は **Storage 1 個・PE 4 個・DNS 4 ゾーン・サブネット 2 個**。ホストと exports を統合し、アプリ MI / 取得者は exports のデータ権限のみ。ホスト UAMI のアカウント全体ロールは保持。Blob 組み込み、Monitor Logs V2 管理コネクタ用の API 接続 1 個とアクセスポリシーを採用。構成図・8 設定・portal 接続 JSON 保存・時間範囲選択を顧客資料へ反映した。旧 LAW_ID は LAW_RESOURCE_ID（ARM ID）へ変更。
- **最新の検証状態（2026-10-21）**: 既存 WS1 を保持・再利用し、3 段階 ARM の validate / what-if / 実投入が成功。新アプリと単一 Storage で 1 月 4 件・0 件月・2 月 1 件を保存し、current が指す manifest / CSV を組み込み readBlob で独立読み戻しして BOM・特殊文字・件数・MD5 を照合。不正 KQL / 列不一致の Failed と current 不変も確認。動的な時間範囲種別 `"3"`、MI の追加 audience、Blob の正式な接続キーを実機で確定し正本・配布物へ反映。公開化・キー・検証用 VM は使っていない。提供者の管理 API 検証と未実施の portal 受入・公式サポート確認を区別する。詳細は [plan.md](plan.md) §19。
- **再起動・旧 run の確認（2026-10-21）**: host / connections / workflow の JSON が再起動後も同一で、ワークフロー本体を再配置せず実行・4 件の実 CSV 読み戻しに成功。同月再実行後も初回の CSV / manifest を直接読み、ハッシュ・件数・runId の保持を確認した。保存 MIME は CSV / JSON とも `text/plain; charset=utf-8` である点を運用手順に明記。
- **削除事故と復旧（2026-10-21）**: 今回の 22 資源・6 ロールは削除済み。ただしサイトの汎用 DELETE で、保持予定の既存の空 WS1 プランも連動削除された。元の宣言 1 個だけを validate / what-if 後に再投入し、同一 ID・リージョン・WS1・kind・最大ワーカー数・アプリ 0 件・Ready を直接 GET で確認して復旧した。RG の現存資源は復旧プラン 1 個のみ。元リソースを保持できたという結果ではなく、宣言外の動的属性まで一致する保証はない。保持には `deleteEmptyServerFarm=false` 明示が必要で、事前 GET 保全と終了後比較を作業指示・保守資料・顧客の削除手順へ追加。詳細は [plan.md](plan.md) §19。
- **顧客提供方針（2026-10-20）**: 主サンプルは WS1 とし、公式サポート範囲の確認を導入前の必須条件にすることをユーザーと確認した。[customer/README.md](../customer/README.md) を入口として、portal 投入用 ARM JSON・設定・ワークフロー・導入運用受入手順を整理。生成元と静的検証は [保守手順](customer-maintenance.md) を参照。WS1 の動作実績をサポート保証とは扱わない。
- **過去の実機受入の保留（2026-10-20）**: 資料整備と静的テスト 8 件の成功時点では、ユーザーの指示でサポート確認待ちとして実機受入を保留し、この日の資料整備では Azure リソースを作成しなかった。翌日の提供者による最小構成検証とは別の記録。顧客導入はサポート回答と構成・費用・作成権限の承認後に行う。
- **実データなしのテスト手順（2026-10-20）**: [受入確認](../customer/docs/validation.md) §2.1 に、既存の datatable ダミーデータを使う設定・手動実行・CSV 確認・0 件 / 翌月境界・終了手順を追加。ログ取り込みと診断設定は不要だが、実際の LAW API / 非公開 Blob を使うため Azure 基盤と権限は必要。評価後は無効化し、サポート確認待ちによる実機受入の保留は継続する。
- **中間の顧客用 WS 構成（2026-10-21、§18）**: Storage 2 個・PE 5 個・DNS 4 ゾーンだった。最新の §19 で Storage 統合と Blob PE 共用へ更新した。ホスト Queue / Table は Stateful 依存として保持し、File / AMPLS / 未使用予約サブネットは引き続き除外する。共有基盤の既定は旧 PoC を保持するが、ワークフロー正本自体はコネクタ版に変更済み。
- **WS プランのサポート可否**: [公式資料](https://learn.microsoft.com/en-us/azure/logic-apps/create-single-tenant-workflows-azure-portal#set-up-managed-identity-access-to-your-storage-account)ではホスト Storage のキー無効化は不可とされている。今回の ARM 構成（コンテンツ共有を使わない）で動いたが、サポート範囲かどうか、portal デザイナーでの編集・保存を含む長期安定は未確認。Microsoft サポートなどで確認する。
- ワークフローの配置は、SCM が非公開のため ARM の `hostruntime` 管理 API 経由で行った。顧客向けの portal 手順を文書化したが、portal だけでの新規作成・編集・保存・再起動・CSV 取得は実機未検証。管理 API での配置・保存済み CSV 読み戻しの成功を portal 完結の実証と扱わない。成立しない場合は停止し、顧客に管理 API / CLI で代替させない。
- 設定変更直後の再起動中は管理 API が ServiceUnavailable を返す。起動を待って再実行する。
- ワークフローを読み込んだ直後にトリガーが 1 回発火したとみられる。月次トリガーの初回挙動を確認する。
- 未検証: 実際の月次発火（毎月 5 日 9:00 JST）、50 万行超の分割、PartialError の実発生、Bastion 経由のブラウザー操作、本番相当のデータ量。
- 管理 VM は Standard_B2s が Southeast Asia で容量制限のため、D2as_v7 を使った。

## 7. 技術メモ（ハマりどころ）
- 旧 HTTP Query API の上限: 50 万行、約 64 MB（圧縮）、10 分。既定タイムアウトは 180 秒（`Prefer: wait=`）。HTTP 200 でも `error.code=PartialError` があり得る。現在の Monitor Logs 管理コネクタは応答約 16 MiB・クエリ 100 秒 / 全体 110 秒であり、旧上限を適用しない。
- 動的列は `project bag=pack_all()` で受け、管理コネクタ本文の必須 value 配列を Parse JSON で検証後、各行を `json(string(item()['bag']))` で正規化する。列は設定 `COLUMNS` で指定する。`value: []` の正常応答だけを 0 件として扱い、欠損を空配列へ変換しない。
- 旧版で使った Standard の HTTP アクション既定の送信タイムアウトは 225 秒、メッセージサイズ上限は 100 MB。現行ワークフローに HTTP アクションはない。
- ASE 構成では、内部 VIP のためプライベート DNS ゾーン `<ase>.appserviceenvironment.net` に `*`、`@`、`*.scm` を登録する。
- ホスト Storage の必要ロール: Storage Account Contributor、Storage Blob Data Owner、Storage Queue Data Contributor、Storage Table Data Contributor。
- 出力への書き込みは、Logic App のシステム割り当て MI に exports コンテナースコープの Storage Blob Data Contributor を付与。Log Analytics には Log Analytics Reader を付与。
- az CLI 環境（cmd 経由）では、複数行スクリプトの引数渡しや `--query` の記号がうまく動かないことがある。ファイル渡し（`@file`）を使う。

## 8. 次にやること（候補）
1. Consumption 案を検証：初回から Public network access Disabled・Shared Key 無効、信頼されたサービスの例外とシステム MI でダミー CSV を保存・独立読み戻しできること。WS1 を引き続き使う場合のサポート確認とは区別する。
2. 本番想定のワークフローの作り込み：チャンク分割（50 万行超）、PartialError 実発生の確認、再試行方針、アラート（失敗通知）。
3. 現行配布物を維持しつつ、Consumption の検証後に生成元・ARM・ワークフロー・顧客手順を一式更新する。構成・費用・権限の承認後に portal のみの実機受入（構築、編集保存、手動実行、CSV 取得、削除）を行う。
4. 採用候補の必要資源・構成・費用・権限の確認と承認。
5. 月次トリガーの実発火の確認。
6. 検証用スクリプトのパラメーター化（リソース名のハードコード除去）。

## 9. 公開情報の参照先

以下は判断に用いた公開仕様です。顧客の制約・合意事項、実測結果、サンプル独自の出力契約は本書の記録であり、公開資料が保証する内容ではありません。

| 参照する仕様 | 公開資料 |
|---|---|
| Stateful の状態保持と Blob / Queue / Table 利用 | [Stateful / Stateless](https://learn.microsoft.com/en-us/azure/logic-apps/single-tenant-overview-compare#stateful-stateless)、[Standard の Storage 利用](https://learn.microsoft.com/en-us/azure/logic-apps/estimate-storage-costs) |
| Blob 組み込み・Monitor Logs 管理コネクタと MI 認証 | [Blob 操作](https://learn.microsoft.com/en-us/azure/logic-apps/connectors/built-in/reference/azureblob/)、[Monitor Logs の制限](https://learn.microsoft.com/en-us/azure/connectors/connectors-azure-monitor-logs)、[MI 接続とアクセスポリシー](https://learn.microsoft.com/en-us/azure/logic-apps/authenticate-with-managed-identity) |
| 旧 HTTP Query API の上限・既定タイムアウト・部分応答 | [Query API 制限](https://learn.microsoft.com/en-us/azure/azure-monitor/fundamentals/service-limits#query-api)、[タイムアウト](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/api/timeouts)、[PartialError](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/api/response-format) |
| 旧 HTTP アクションのタイムアウト・メッセージサイズ | [Logic Apps の制限](https://learn.microsoft.com/en-us/azure/logic-apps/logic-apps-limits-and-config) |
| 旧 ASE の内部 VIP と DNS | [ASE ネットワークと DNS](https://learn.microsoft.com/en-us/azure/app-service/environment/networking) |
| ホストの MI ロールと exports のデータ権限 | [ホスト Storage の MI 設定](https://learn.microsoft.com/en-us/azure/logic-apps/create-single-tenant-workflows-azure-portal#set-up-managed-identity-access-to-your-storage-account)、[Blob データへの権限](https://learn.microsoft.com/en-us/azure/storage/blobs/authorize-data-operations-portal) |
| 最後のアプリ削除時の空プラン削除と保持パラメーター | [Web Apps Delete](https://learn.microsoft.com/en-us/rest/api/appservice/web-apps/delete?view=rest-appservice-2024-04-01) |
| Consumption の例外接続と Public 無効時の扱い | [Blob 管理コネクタとシステム MI](https://learn.microsoft.com/en-us/azure/connectors/connectors-create-api-azureblobstorage#access-blob-storage-in-same-region-with-system-managed-identities)、[Storage の例外優先・注意事項](https://learn.microsoft.com/ja-jp/azure/storage/common/storage-network-security-limitations) |
