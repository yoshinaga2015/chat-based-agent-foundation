# Chat-based Agent Foundation

対話、承認、カンバン、スキル、ワークフロー、BrowserUse、MCP を持つエージェントの殻です。不動産の計算や台帳は入っていません。

## 要件

Node.js 22 以上、pnpm 10、Cloudflare CLI（`cf`）。対話は `cf auth login` したアカウントの AI バインディングを使います。

## ローカル

```sh
pnpm install
cf auth login
pnpm --filter web dev
```

画面は http://127.0.0.1:4174 です。API は同じコマンドが 4175 で起動します。

## 配備

このリポジトリの Worker 名は `fudo-api` です。fudo を置いてある Cloudflare アカウントで `cf deploy` すると、その本番を上書きします。確認は別のアカウントで行ってください。

```sh
cf auth login
cf d1 create --name fudo-ledger
cf r2 buckets create --name fudo-docs
pnpm --filter api run deploy
```

D1 の表は最初のリクエストで作られます。配備がデータベースやバケットの不在で止まったときは、上の2つの名前で作り直してから、もう一度 deploy します。

URL を開くと対話できます。Access の3変数を置いていないあいだ、URL を知っている人は入れます。人に渡す前に、次を Worker に設定してから配備し直してください。

- `CF_ACCESS_TEAM_DOMAIN`
- `CF_ACCESS_AUD`
- `FUDO_OWNER_EMAIL`

## 環境変数

既定では空で足ります。`.env.example` を見てください。

| 変数 | いつ要るか |
|---|---|
| `AGENT_CHAT_MODEL` | 対話モデルを変えるとき。空なら Gemma 4 |
| `CF_ACCESS_TEAM_DOMAIN` `CF_ACCESS_AUD` `FUDO_OWNER_EMAIL` | 入口を持ち主だけにするとき。3つ揃えて初めて検証する |
| `FUDO_ENABLE_CONTAINERS=1` と `ANTHROPIC_API_KEY` | Claude Code（`run_agent`）。Workers Paid の Containers が要る |
| `GITHUB_APP_ID` `GITHUB_APP_INSTALLATION_ID` `GITHUB_APP_PRIVATE_KEY` `FUDO_AGENT_REPOS` | リポジトリへの PR。Containers と一緒に置く |

値がある資格情報だけ Secret として宣言します。空のままなら配備は通り、その能力は出ません。

## できること、できないこと

できること: 対話、スレッド、承認、カンバン、スキル、ワークフロー、Web 検索、ページの読み取り。

Workers Paid が要るもの: BrowserUse（Browser Run）、Claude Code のコンテナ。

できないこと: 不動産の試算、地価、物件台帳。利用者ごとのログイン（配備の持ち主が1人、という前提）。

## ライセンス

MIT。`LICENSE` を見てください。
