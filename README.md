# 老麥計算機

[![CI](https://github.com/CSL426/mcd-calc/actions/workflows/ci.yml/badge.svg)](https://github.com/CSL426/mcd-calc/actions/workflows/ci.yml)

> 非官方工具，與麥當勞無任何從屬關係。價格與兌換點數以門市及官方 APP 為準。

比較麥當勞點數（M Point、點點卡）每一點實際值多少錢，並把套餐、1+1、甜心卡、分享盒、
期間限定的買幾送幾算進去。前提是已經有甜心卡。

TypeScript + Vite（不用框架），正式環境是一個 Docker container：nginx 直接提供打包好的靜態檔。

## 開發

```
pnpm install
pnpm dev          # http://localhost:5173
pnpm test         # Vitest
pnpm typecheck
pnpm build        # 輸出到 dist/
```

## Docker

```
docker compose build
docker compose up -d   # http://localhost:8080，改 port 用 WEB_PORT=xxxx
```

Dockerfile 分兩段：`builder`（Node 26 LTS + pnpm，跑測試和打包，測試沒過就不出 image）→
`runner`（nginx 1.30 stable，只放 `dist/` 和 `nginx.conf`）。
nginx 對 `/assets/` 長期快取（檔名帶 hash），`/data/` 和頁面本身 `no-cache`，健康檢查在 `/health`。

## CI/CD

`.github/workflows/ci.yml`：

- 每次 push 和 PR：型別檢查 → 測試 → 打包。
- 推到 `main` 且上面全過：build image，推到 `ghcr.io/csl426/mcd-calc`（公開，標籤 `latest` 和短 commit hash）。
- 接著部署到 Cloud Run（`asia-east1`）：用 image digest 部署，`min-instances=0`（沒人用不收錢）、
  `max-instances=1`（費用上限），部署後打 `/health` 確認。Cloud Run 直接拉 ghcr.io 的公開 image，
  GCP 上不存 image。repo 還沒設 GCP 變數時，部署這段會自動跳過。

### 第一次設定 Cloud Run

小專案共用作品集的 GCP 專案 `csl-portfolio`，各自一個 Cloud Run 服務。在已經 `gcloud auth login`
的機器上跑一次：

```
PROJECT_ID=csl-portfolio SA_NAME=mcd-calc-deployer PROVIDER=github-oidc-mcd-calc bash tools/gcp-setup.sh
```

它會啟用 API、建這個 repo 專用的部署 service account，並在既有的 WIF pool 加一個只允許這個 repo 的
provider（不改同專案其他服務的設定，GitHub 上不存任何 GCP 金鑰）。要開獨立專案的話改給新的
`PROJECT_ID` 和 `BILLING_ACCOUNT`。最後印出三個值，設成 repo 的 Actions variables：
`GCP_PROJECT_ID`、`GCP_SA_EMAIL`、`GCP_WIF_PROVIDER`。之後每次推到 `main` 就會自動部署。

建議另外在 GCP 帳單設一個低額預算警示。預算警示只寄信、不會停止扣款，費用上限靠 `max-instances=1`。

## 目錄

| 路徑 | 內容 |
|---|---|
| `src/calc.ts` | 純計算邏輯（排行、分攤、點餐推薦、資料驗證），不碰 DOM |
| `src/main.ts` | 畫面 |
| `src/types.ts` | `offers.json` 的型別 |
| `public/data/offers.json` | 所有價格、優惠、兌換資料 |
| `tests/` | Vitest 測試 |
| `tools/build_offers.py` | 第一次產生資料用的腳本 |

## 更新資料

所有數字都在 `public/data/offers.json`：

| 陣列 | 放什麼 |
|---|---|
| `currencies` | 點數種類，`earnPerDollar` = 每消費 1 元得幾點 |
| `items` | 品項牌價；同類品項可加 `portionGroup` + `portion`（份量）讓優惠照份量拆錢；`ref` 官網商品頁、`conflict` 記另一個來源的不同價格 |
| `deals` | 現金優惠，三種寫法見下表 |
| `redemptions` | 點數兌換：`points` 點（加 `cash` 元）換 `items`；`label` 是補充說明（擇一、點數＋現金） |
| `promos` | 點數兌換的期間折扣，`rules` 依序比對，第一條符合的 `multiplier` 生效；`excludeRedemptions` 排除不適用的兌換 |

`deals` 的寫法：

| `type` | 用在 | 欄位 |
|---|---|---|
| `combo` | 套餐、1+1、分享盒、買幾送幾 | `groups`：每組挑一個（`{ "ids": [...], "qty": 2 }`）；`price` 固定價，或 `discount` 分開買再折多少 |
| `bogo` | 甜心卡式買 A 送 B | `buy`、`get`，`fee` 為卡費 |
| `bundle` | 內容固定的組合 | `items`、`price` |

共通欄位：

- `start` / `end`：期間（`YYYY-MM-DD`，含當天）；兩個都是 `null` 代表常駐。
- `enabled: false`：暫時不算但留著。
- `asOf`：**那份資料本身的日期**，不是抓取日；來源沒寫日期就填 `null`，頁面會標「不明」。
- `verified: true`：已在 APP 或門市親自確認，頁面上的「待確認」就會消失。

也可以在頁面最下方的「資料」區直接改，套用後只存在這台瀏覽器，確認後按「下載 offers.json」覆蓋回 repo。

`tools/build_offers.py` 是第一次產生資料用的，之後直接改 JSON；再跑它會蓋掉手動修改。

## 算法

- 每點價值 =（品項價 − 要另付的現金）÷ 點數；期間內的點數折扣先乘在點數上。
- 「實際」那欄把牌價換成最便宜現金價：每個有效優惠的實付金額拆給裡面的品項，同類照份量、
  不同類照牌價；每個品項取對自己最有利的搭配。
- 回饋率 = 實際每點價值 × 每元得點數，跨點數比較時看這個。

## 我想吃什麼（點餐推薦）

選好想吃的品項和數量，`planOrder` 會窮舉現在有效的套餐、1+1、甜心卡、買送，找出剛好湊齊這些東西的最低價；
填了點數餘額，會再算一個「加上點數」的版本（以少付現金為目標，並列出每筆用了幾點）。
不推薦多買、也還沒考慮早餐／10:30 後的供應時段。

## 資料來源

每筆資料的 `source` 寫原始來源；速速湊這類轉手彙整只標「經…彙整」，不當成資料日期。

- 品項價格：cashfeel《2026 麥當勞菜單》（11/05 更新）與速速湊彙整交叉比對；一致的標 cashfeel 日期，
  不一致的在 `conflict` 寫出另一邊的價格，只有速速湊有的日期標不明。
- 套餐、1+1、分享盒規則：麥當勞官網餐點注意事項；組合內容與金額經速速湊彙整。
- M Point 兌換表：PTT fastfood〈麥當勞點數回饋率計算〉（2024-09-23），點數很可能已調整，待用 APP「M Point 樂園」更新。
- 點點卡兌換表：麥當勞官網點點卡兌換商品頁（圖上印的點數，圖檔 2026-05-27 版，11/18 查）。
  2026 年中起兌換點數調高、套餐與「點數＋現金」下架，只剩 8 樣（Heresy's Space〈麥當勞點點卡回饋縮水〉，2026-07-04）。
- 週年慶：麥當勞官網 APP 回饋頁、蘋果仁整理。
- 薯條份量：麥當勞官網營養資訊（熱量）。
