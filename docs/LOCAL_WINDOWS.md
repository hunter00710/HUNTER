# Windows本機部署與全流程測試

適用Windows 10／11、Node.js 24.22.1至24.x。提供雙擊啟動工具，不需Git、Docker、npm install或修改PowerShell執行原則。這份流程須在你自己的電腦執行；ChatGPT雲端工作區啟動服務，不會自動安裝到你的電腦。

## 一、準備兩個下載檔

1. 從官方下載[Node.js 24.22.2](https://nodejs.org/zh-tw/download/archive/v24.22.2)，一般Intel／AMD Windows電腦選`node-v24.22.2-x64.msi`；ARM電腦選ARM64。安裝精靈保留PATH選項。已安裝24.22.1以上24.x者可沿用。
2. 下載[原型程式ZIP](https://github.com/hunter00710/HUNTER/archive/refs/heads/jplus/multiuser-prototype.zip)，右鍵「全部解壓縮」。建議解壓縮到自己的本機資料夾，例如`C:\JPLUS\HUNTER`，不要直接在ZIP內執行，也不要將財務資料放在公開或多人同步資料夾。
3. 從既有檔案下載原本的`JPLUS_金像應收資金戰情室V4.html`，保存於自己可存取的位置。完整BI測試需要這份原始HTML；只有ZIP的合成模式是精簡權限介面。

官方版本清單：[Node 24.22.2](https://nodejs.org/zh-tw/download/archive/v24.22.2)。本次本機核心驗證使用24.22.1，GitHub工作流程亦固定此版。

## 二、初始化一次

1. 關閉安裝前已開啟的命令視窗，進入解壓縮後含`package.json`的資料夾。
2. 雙擊`01_Setup.cmd`。
3. 模式輸入`1`（匯入V4、完整測試）。模式2只有合成資料與基本權限介面；不含完整V4 BI頁面。
4. 在Windows檔案總管對V4檔案按右鍵→「複製為路徑」，貼到初始化視窗。路徑前後有雙引號也可以。
5. 輸入自己設定的`uat-admin`密碼，至少14字，再輸入一次。輸入時不顯示字元是正常的。
6. 程式先執行自動測試；通過後建立獨立UAT資料庫。保存螢幕顯示的`uat-finance`、`uat-reviewer`、`uat-sales`、`uat-viewer`四組隨機密碼，它們只顯示這一次。

不會修改原HTML，也不把舊瀏覽器localStorage整包覆蓋進資料庫。已存在`local/config.json`時，再跑初始化只會提示使用啟動工具，不覆蓋現有資料。密碼不寫入config，資料庫只保存雜湊。

## 三、啟動、登入與開指南

1. 雙擊`02_Start.cmd`；瀏覽器會自動開啟服務網址。
2. 預設是`http://127.0.0.1:3000`。若3000已使用，初始化會在3001至3010選可用埠；以視窗實際顯示的網址為準。
3. 登入`uat-admin`，密碼是你自己設定的那一組。
4. 點頂部「測試操作指南」，或在相同網址後加`/guide`。
5. 完整模式應載入36筆PO、20筆應付。指南會自動列出此次的PO A、PO B、未知基準PO、付款項目、原幣與測試截止日。

保持啟動視窗開啟。若要停止，按`Ctrl+C`；下一次再雙擊02_Start即可。關閉瀏覽器不會停止服務，也不會刪除資料。啟動視窗停了就不能連線。

## 四、角色與瀏覽器安排

| 視窗 | 帳號 | 用途 |
|---|---|---|
| Edge一般視窗 | uat-finance | 登錄、PO及模型維護 |
| Chrome一般視窗 | uat-admin | 管理者、多人衝突與稽核 |
| Edge InPrivate或第三個設定檔 | uat-reviewer | 他人交易銀行覆核 |
| 測試時依序切換 | uat-sales、uat-viewer | PO資料範圍與唯讀限制 |

同一個瀏覽器的一般分頁會共用Cookie；第二個分頁換帳號，第一個分頁也會受到影響。多人測試請用不同瀏覽器、不同設定檔或一般＋私密視窗。

uat-sales僅獲授權PO A。其他四個測試角色具有全公司資料讀取範圍，但可寫操作仍依角色受限。這些全是UAT帳號，不是已開通的正式同仁帳號。

## 五、完整操作順序

完整逐步教學在登入後的`/guide`，可勾選12個階段、列印成PDF或下載人工測試紀錄。人工勾選不是系統自動驗證。

| 順序 | 測試操作 | 成功判定 |
|---|---|---|
| 1 | 管理者登入並核對母體 | 36筆PO、20筆應付，日期一致 |
| 2 | 五種角色登入 | 業務僅PO A；唯讀無法寫入；財務不能自行銀行覆核 |
| 3 | 修改PO A負責人／交付 | 表單保存是草稿；頂部送出後重載仍保留 |
| 4 | 多PO收款 | PO A未稅600＋PO B未稅400＋稅50＝銀行1,040＋匯費10 |
| 5 | 差額、重複憑證、超額、未知基準 | 錯誤被阻擋，不產生新交易 |
| 6 | 換覆核角色確認銀行 | 登錄及覆核人不同，金額未改寫 |
| 7 | 供應商原幣付款100 | 指定設備原幣未付減100，兩幣仍分開 |
| 8 | 已確認分期與13週模型 | 缺值不給假缺口，僅確認排程納入 |
| 9 | 兩個視窗改同一版本PO | 一方成功、另一方409衝突；草稿保留 |
| 10 | 作廢及異動稽核 | 餘額還原、交易保留、前後值及操作者可查 |
| 11 | 備份、停止、重啟、隔離還原 | 資料持續存在、外鍵／稽核完整 |
| 12 | 確認本機與正式環境界線 | 尚未開放其他電腦，也沒有把UAT當正式收付 |

測試銀行編號使用`UAT-REC-001`，付款使用`UAT-PAY-001`。同一編號不可重複；再次練習可用002、003。測試日期使用指南顯示的工作截止日，不直接換成操作當天，以免超過截止日被正確拒絕。

## 六、日常備份與資料檢查

- 雙擊`03_Backup.cmd`：備份到`local\backups`，每次新檔，不覆蓋前檔。
- 雙擊`04_Check.cmd`：應顯示`integrity:true`、`auditChain:true`、`foreignKeys:true`。
- 管理者或財務也可從畫面匯出公司備份。檔案含公司資料、原V4頁面與稽核，請保存於授權位置；未加密、沒有密碼或Session。

## 七、隔離還原演練

以下只建立新的還原資料庫，不切換、不覆蓋現行UAT。先保留03_Backup產生的完整路徑。

在專案資料夾空白處按右鍵→「在終端機中開啟」，使用PowerShell逐行執行：

```powershell
# 把路徑改成你剛才的備份檔；不要原樣照貼這個示範檔名。
$backup = "C:\JPLUS\HUNTER\local\backups\jplus-實際日期.backup.json"
# 此檔必須尚不存在；每次演練請用不同檔名。
$env:DB_PATH = "data\restore-practice-01.sqlite"
node scripts/admin.js restore $backup
node scripts/admin.js check

# 歷史帳號還原後全部停用，建立一個新的還原管理者。
$secret = Read-Host "設定還原管理者密碼，至少14字" -AsSecureString
$env:JPLUS_PASSWORD = [System.Net.NetworkCredential]::new("", $secret).Password
node scripts/admin.js create-user recovery-admin admin "*"
Remove-Item Env:JPLUS_PASSWORD

# 只在另一個本機連接埠啟動還原庫；若3011已使用，改成其他埠並同步修改APP_ORIGIN。
$env:HOST = "127.0.0.1"
$env:PORT = "3011"
$env:APP_ORIGIN = "http://127.0.0.1:3011"
$env:NODE_ENV = "development"
node src/server.js
```

另開瀏覽器到`http://127.0.0.1:3011`，用recovery-admin登入，核對PO、收付款、作廢及稽核。測試完按Ctrl+C並關閉該終端機；02_Start仍使用原config的UAT資料庫。不要直接把備份匯入目前使用中的資料庫。

## 八、常見問題

| 畫面／錯誤 | 處理 |
|---|---|
| 找不到node | 安裝官方Node 24.x，重開01_Setup；確認不是Node22或26 |
| 看不到01_Setup.cmd | ZIP尚未解壓縮，或開錯上層資料夾；進入含package.json的資料夾 |
| 密碼欄沒有字 | 初始化密碼輸入刻意不回顯，輸完按Enter |
| 重新跑初始化 | 不會覆蓋；請使用02_Start。如需全新測試，先停止服務，將local/config.json改名保存，再跑01_Setup建立新庫 |
| 只能看到精簡權限頁 | 選了合成模式；完整BI需用原V4建立另一個新的UAT庫 |
| 頁面打不開／拒絕連線 | 檢查02_Start視窗仍在、網址埠是否正確；不要將127.0.0.1改localhost混用 |
| 來源或CSRF驗證失敗 | 使用啟動視窗顯示的完整網址重新登入，避免不同主機名／埠或舊分頁 |
| 設備銀行狀態選已核後不能送出 | 新交易須「待核對」，交另一個uat-reviewer帳號覆核 |
| 版本衝突 | 先下載草稿，再載入最新資料比較，不要強行覆蓋 |
| 忘記某角色密碼 | 用uat-admin在帳號管理重設；若畫面沒有密碼欄，依下方CLI方式重設 |
| 資料庫不見 | 整個data及local資料夾不可刪除；用備份還原到新庫，不要反覆初始化猜測 |

目前管理畫面可改權／停用，密碼重設用CLI。先在專案資料夾終端機執行：

```powershell
$config = Get-Content .\local\config.json -Raw | ConvertFrom-Json
$env:DB_PATH = $config.dbPath
$secret = Read-Host "新密碼，至少14字" -AsSecureString
$env:JPLUS_PASSWORD = [System.Net.NetworkCredential]::new("", $secret).Password
node scripts/admin.js reset-password uat-finance
Remove-Item Env:JPLUS_PASSWORD
```

最後一行帳號可改成你要重設的UAT帳號；重設會撤銷該帳號舊Session。

## 九、本機部署完成的判定

你電腦實際啟動服務、登入成功、重啟資料仍保留，才算你的本機部署完成。本文件與安裝工具本身不能證明它已在你電腦執行。

`127.0.0.1`只指目前這台電腦；Alex的電腦輸入相同網址不會連到Hunter電腦。要跨電腦協作，下一階段需公司主機、HTTPS、網路設定與正式帳號／備份，不要直接關閉本原型的對外監聽保護。
