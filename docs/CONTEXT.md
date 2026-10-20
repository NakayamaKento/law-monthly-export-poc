# プロジェクトコンテキスト（経緯・決定事項・制約）

このファイルは、これまでの議論をリポジトリに引き継ぐためのものです。設計と検証の詳細は [plan.md](plan.md) を参照してください。

## 1. 目的
お客様環境で、Azure Log Analytics のログを**月次で CSV にエクスポート**する作業を自動化する。現在は手作業。

## 2. お客様側の制約（変更不可）
- Azure 環境へアクセスできる端末は限られ、その端末には Az PowerShell や Azure CLI を入れられない。**ローカルでのコマンド実行は不可**。
- 運用担当者は高度な開発が得意ではない。**portal だけで運用できること**。
- セキュリティレベルが高く、**パブリックアクセスは無効、プライベート通信のみ**（VNet 統合 / プライベートエンドポイント）。
- CSV 形式で保管する。保存先は非公開の Blob。
- **キー認証は不可**（ホスト用 Storage を含む）。共有キー無効、マネージド ID を使う。
- 自動化専用の VM は不可。
- 優先順位: Logic Apps または Automation Account を優先し、Azure Functions はなるべく使わない。

## 3. PoC で合意した条件
- リージョンは Southeast Asia、新規環境。VPN などの接続は PoC では使わない。
- Entra ID と Azure 管理系の送信通信は許可。データ通信はプライベート。
- 一時的な管理 VM（Bastion 利用可）と NAT Gateway は許可。
- AzureActivity の診断設定による取り込み（Microsoft のプライベート経路）はサンプル用の例外として許可。
- デプロイは ARM テンプレート（portal のカスタムデプロイ）を想定。
- 固定費のある構成は可。本番デプロイ前に費用の承認を取る。
- 検証環境は検証後に必ず削除する。失敗したら、その環境だけ削除して計画を見直してやり直す。キー認証やパブリックアクセスの有効化に逃げない。

## 4. 検討結果と決定事項
| 候補 | 判断 | 理由 |
|---|---|---|
| Automation Account | 不採用 | クラウドジョブはプライベートエンドポイント保護の Storage に届かず、Hybrid Runbook Worker（実行 VM）が必要。VM 不可の制約に反する |
| Azure Functions | 比較のみ | 優先度が低い |
| **Logic Apps Standard** | **採用** | HTTP アクション + マネージド ID で Log Analytics Query API を直接呼べる |

Log Analytics の ARM 経由のクエリは Private Link を使えず、Logic Apps の Log Analytics コネクタも該当する。そのため、組み込み HTTP アクションで `https://api.loganalytics.azure.com/v1/workspaces/{id}/query`（トークンの audience は `https://api.loganalytics.io`）を直接呼ぶ。

## 5. 実機検証の結果（概要）
詳細は [plan.md](plan.md) の §12・§13。2 構成とも成功し、環境は削除済み。

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
- **顧客提供方針（2026-10-20）**: 主サンプルは WS1 とし、公式サポート範囲の確認を導入前の必須条件にすることをユーザーと確認した。[customer/README.md](../customer/README.md) を入口として、portal 投入用 ARM JSON・設定・ワークフロー・導入運用受入手順を整理。生成元と静的検証は [保守手順](customer-maintenance.md) を参照。WS1 の動作実績をサポート保証とは扱わない。
- **実機受入の保留（2026-10-20）**: 資料整備と静的テスト 8 件の成功後、ユーザーの指示でサポート確認待ちとして実機受入を保留した。再開時はサポート回答の条件を照合し、構成・費用・作成権限の個別承認を得てから実施する。Azure リソースは今回作成していない。
- **WS プランのサポート可否**: 公式資料ではホスト Storage のキー無効化は不可とされている。今回の ARM 構成（コンテンツ共有を使わない）で動いたが、サポート範囲かどうか、portal デザイナーでの編集・保存を含む長期安定は未確認。Microsoft サポートなどで確認する。
- ワークフローの配置は、SCM が非公開のため ARM の `hostruntime` 管理 API 経由で行った。顧客向けの portal 手順を文書化したが、同梱資材での新規作成・編集・保存・再起動後の永続化・CSV 取得は実機未検証。成立しない場合は停止し、管理 API / CLI で代替して完了と扱わない。
- 設定変更直後の再起動中は管理 API が ServiceUnavailable を返す。起動を待って再実行する。
- ワークフローを読み込んだ直後にトリガーが 1 回発火したとみられる。月次トリガーの初回挙動を確認する。
- 未検証: 実際の月次発火（毎月 5 日 9:00 JST）、50 万行超の分割、PartialError の実発生、Bastion 経由のブラウザー操作、本番相当のデータ量。
- 管理 VM は Standard_B2s が Southeast Asia で容量制限のため、D2as_v7 を使った。

## 7. 技術メモ（ハマりどころ）
- Query API の上限: 50 万行、約 64 MB（圧縮）、10 分。既定タイムアウトは 180 秒（`Prefer: wait=`）。HTTP 200 でも `error.code=PartialError` があり得る。空の結果は 204 の場合がある。
- 動的列は文字列で返るため、`project bag=pack_all()` で受け、`json(string(item()?[0]))` で正規化している。列は設定 `COLUMNS` で指定する。
- Standard の HTTP アクション既定の送信タイムアウトは 225 秒、メッセージサイズ上限は 100 MB。
- ASE 構成では、内部 VIP のためプライベート DNS ゾーン `<ase>.appserviceenvironment.net` に `*`、`@`、`*.scm` を登録する。
- ホスト Storage の必要ロール: Storage Account Contributor、Storage Blob Data Owner、Storage Queue Data Contributor、Storage Table Data Contributor。
- 出力 Storage への書き込みは、Logic App のシステム割り当て MI に Storage Blob Data Contributor を付与。Log Analytics には Log Analytics Reader を付与。
- az CLI 環境（cmd 経由）では、複数行スクリプトの引数渡しや `--query` の記号がうまく動かないことがある。ファイル渡し（`@file`）を使う。

## 8. 次にやること（候補）
1. WS プラン構成のサポート可否を確認（または代替として ASE を採用）。
2. 本番想定のワークフローの作り込み：チャンク分割（50 万行超）、PartialError の検出、リトライ、アラート（失敗通知）。
3. 顧客向け資料・静的確認を維持し、サポート・構成・費用の別途承認後に portal のみの実機受入（構築、編集保存、再起動、手動実行、CSV 取得、削除）を行う。
4. 費用見積もり（ASE と WS の比較）と承認。
5. 月次トリガーの実発火の確認。
6. 検証用スクリプトのパラメーター化（リソース名のハードコード除去）。
