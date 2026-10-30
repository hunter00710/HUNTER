# JPLUS 樂加智多人共用系統原型

將既有 V4 戰情室接到登入保護的 API 與關聯式資料庫，保留原本的 BI、會計核對及 13 週情境計算。這是可測試原型，尚未正式部署。

Windows首次操作可直接看[本機部署與全流程測試](docs/LOCAL_WINDOWS.md)：下載ZIP後依序雙擊01_Setup.cmd、02_Start.cmd；登入後內建`/guide`提供12階段驗收、此次測試PO及人工勾選紀錄。不需Git、Docker或npm install。01_Setup建立獨立UAT資料庫與五個測試角色，不覆蓋既有資料；只有匯入原V4模式含完整BI。

## 快速啟動：先用合成資料

需求：Node.js **24.22.1 至 24.x**。無執行期第三方套件，不需 `npm install`。

```powershell
git clone https://github.com/hunter00710/HUNTER.git
cd HUNTER
# 若程式位於待審分支，先切換到該分支：
git switch jplus/multiuser-prototype
node --version
npm test
npm run demo
# 終端機只顯示一次隨機產生的 demo-admin 密碼，請先保存。
npm start
```

用瀏覽器開啟 <http://127.0.0.1:3000>。合成資料介面提供登入、PO 交付、帳號與覆核測試；完整 BI 要先匯入原 V4。

## 匯入既有 V4

**不要把原 HTML、資料庫、備份或銀行資料加入 Git。** 此儲存庫為公開庫，只保存程式及合成測試資料。V4 的硬編碼財務文字也屬受保護來源；因此整份原頁面存入登入保護的資料庫，沒有提交到 GitHub。

請用另一個空資料庫，避免與 demo 混用。PowerShell 範例：

```powershell
$env:DB_PATH="data/jplus-company.sqlite"
node scripts/admin.js import-v4 "C:\JPLUS-private\JPLUS_金像應收資金戰情室V4.html"
# 安全讀取密碼；不把密碼寫進命令或 Git
$secret = Read-Host "設定管理者密碼，至少14字" -AsSecureString
$env:JPLUS_PASSWORD = [System.Net.NetworkCredential]::new("", $secret).Password
node scripts/admin.js create-user hunter admin "*"
Remove-Item Env:JPLUS_PASSWORD
npm start
```

沒有自動建立 Hunter、Ann 或 Alex 等真實帳號，也不傳送邀請。管理者登入後可在「稽核／覆核／帳號」開通同仁、設定角色與 PO 範圍。請個別指定帳號，不共用密碼。

匯入只允許空資料庫，核對原會計引擎指紋，並拒絕非空的內嵌工作紀錄。既有瀏覽器 JSON 備份不會被自動讀取或清除；若含未轉存的異動，須先保留備份，再由管理者整理成帶版本的異動批次遷移。

## 已實作

| 項目 | 行為 |
|---|---|
| 登入 | scrypt 密碼雜湊、8 小時 Session、HttpOnly/SameSite Cookie、登入失敗限制 |
| 授權 | 每個寫入 API 驗證角色；業務只能更新獲授權 PO 的交付欄位 |
| 收付款 | PO、應付、分期、收款、多 PO 核銷、付款及覆核 API；交易作廢保留歷史 |
| 資料庫 | SQLite WAL、外鍵、唯一憑證、整批原子交易、金額整數微元欄位 |
| 衝突 | 每筆紀錄版本；衝突回傳 409，整批回滾；不同紀錄可各自保存 |
| 稽核 | 操作者、前後值、時間、雜湊鏈；應用層不提供刪改，資料庫觸發器禁止更新／刪除 |
| 備份 | 授權公司備份、SHA-256 校驗、隔離還原、外鍵與稽核鏈檢查；不含密碼與 Session |
| V4 | 原頁面在登入後產生；原控制引擎及投資／資金模型保留；不用 localStorage 存業務資料 |

原 UI 的「保存」只更新草稿；頂部**「送出至伺服器」成功才完成共用存檔**。頁面每 15 秒檢查資料版本，提示使用者載入最新資料；沒有宣稱 WebSocket 即時同步或自動合併。衝突時可下載草稿，再載入最新資料比較。

## 角色

| 角色 | 可讀資料 | 可寫資料 |
|---|---|---|
| admin | 全公司 | 基準、交易、計畫、帳號；不能覆核自己登錄的交易 |
| finance | 全公司 | 基準、收付款、計畫與模型；不能標記銀行已覆核 |
| reviewer | 全公司 | 核對紀錄、他人交易的銀行覆核與證據 |
| sales | 指定 PO 的必要欄位 | 負責人、驗收、請款、目標日、依據；不能改金額或已收 |
| viewer | 授權 PO；全公司範圍可讀 BI | 無 |

完整 V4 會展示原始資料與全公司財務資訊，僅供全公司資料範圍且非 sales 的角色。局部 PO 權限走精簡介面；不能下載完整來源、稽核或公司備份。銀行覆核由另一名 admin／reviewer 執行。

## 驗證與界線

```powershell
npm test
node scripts/admin.js check
```

測試包括兩個獨立 HTTP Session 同時改同一筆的 200／409 結果、角色與 PO 權限、CSRF、來源檢查、核銷與缺值、重複憑證、超額、作廢還原、覆核分工、資金情境、稽核及備份還原。

完整驗收證據、DOM 整合測試與未驗證項目見 [驗證紀錄](docs/VALIDATION.md)。部署、備份、還原及下一階段見 [部署說明](docs/DEPLOYMENT.md)，API 規格見 [API](docs/API.md)。

Node 24 的 `node:sqlite` 目前為 Release Candidate；本專案固定 24.x 並記錄實測版本。SQLite WAL 需要同一主機的本機磁碟，不能把資料庫放在跨主機共用磁碟。正式擴到多服務實例前，需另做 PostgreSQL 遷移與負載驗證。

官方參考：[Node SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)、[SQLite WAL](https://www.sqlite.org/wal.html)。
