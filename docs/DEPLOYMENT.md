# 啟動、內網部署與還原

## 本機驗收

1. 使用 Node.js 24.22.1 至 24.x，clone 程式並切到原型分支。
2. 執行 `npm test`。不需要安裝執行期第三方套件。
3. 用 README 的 `demo` 建立合成資料，確認帳號、角色及兩個瀏覽器各自登入。
4. 關閉服務，改用另一個空資料庫匯入原 V4。原 HTML 與備份請置於 Git 專案外。
5. 開通管理者，再由管理介面開通其他帳號。不要共用登入；不要用真實客戶交易作第一次測試。
6. 由不同帳號改同一筆 PO，先送出者成功，後送者收到版本衝突；下載草稿後重載比較。

本機預設只監聽 `127.0.0.1`，服務停止後不能連線；遠端同仁不能藉此網址共用。啟動程式不等於完成公司部署。

## 公司內網單一服務

建議由 IT 準備一台持續運作的 Linux VM，使用公司內網 DNS、TLS 憑證及反向代理。服務與 SQLite 資料庫放在同一台主機的本機持久化磁碟，單一服務實例；用應用程式 API 共用資料，不讓同仁直接開資料庫檔。

Linux 範例：

```bash
export DB_PATH=/var/lib/jplus/jplus.sqlite
export NODE_ENV=production
export HOST=127.0.0.1
export PORT=3000
export APP_ORIGIN=https://jplus.company.internal
node src/server.js
```

`APP_ORIGIN` 必須與使用者實際開啟的 HTTPS 網址完全相同（含非預設埠）；否則寫入會因來源驗證失敗。正式模式啟用 Secure Cookie、HSTS；公司憑證與反向代理須由 IT 正確配置。本機 HTTP 測試不能設定 `NODE_ENV=production`，否則 Secure Cookie 不會送出。

使用專用低權限 OS 帳號執行，資料目錄0700、資料庫0600；磁碟與備份由公司提供加密與存取控制。本原型不提供資料庫欄位加密、MFA／SSO、密碼自助重設或電子郵件通知。

`deploy/Caddyfile.example` 提供內網反向代理範例。使用 `tls internal` 時，每台受管裝置需信任該公司測試 CA；商用正式環境請換公司核發憑證。此設定只提供部署方法，未在本次環境實際啟動。

以 systemd／公司既有服務管理維持常駐；程序重啟不會清除持久化資料。必要時用 `node scripts/admin.js reset-password LOGIN`，密碼透過 `JPLUS_PASSWORD` 環境變數提供。不要把密碼、原始 HTML、DB 或備份加到 Git，也不要啟用 GitHub Pages 發布公司資料。

## Docker 選項

有附 Dockerfile，可在具備 Docker 的 IT 環境建置。映像建置、代理、憑證及重啟策略在本次環境**未驗證**。

```bash
docker build -t jplus-prototype:0.1 .
docker volume create jplus-data
# 反向代理設於同機，映射埠只綁localhost。
docker run -d --name jplus --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -e NODE_ENV=production -e HOST=0.0.0.0 -e PORT=3000 \
  -e APP_ORIGIN=https://jplus.company.internal \
  -e DB_PATH=/app/data/jplus.sqlite \
  -v jplus-data:/app/data jplus-prototype:0.1
```

首次匯入與帳號開通可先用一次性管理容器操作同一 volume，原 V4 以唯讀掛載置於 `/imports`，不要 COPY 進映像。完成初始化後再啟動應用容器。

## 備份與還原

全公司 admin／finance 可由介面匯出 `jplus.backup.json`，或在主機執行：

```bash
DB_PATH=/var/lib/jplus/jplus.sqlite node scripts/admin.js backup /secure-backups/jplus-YYYYMMDD.backup.json
```

備份包含 V4 頁面、來源、工作台、核銷關聯、版本與稽核，不含密碼、Session 或登入限制紀錄。SHA-256 用於完整性檢查，沒有加密或外部簽章。公司需設定備份保留、加密、異地保存與排程；本次沒有在主機建立備份排程。

還原只允許全新資料庫；不會覆蓋正在使用的資料：

```bash
DB_PATH=/var/lib/jplus-restore/jplus.sqlite node scripts/admin.js restore /secure-backups/jplus-YYYYMMDD.backup.json
DB_PATH=/var/lib/jplus-restore/jplus.sqlite node scripts/admin.js check
# 透過JPLUS_PASSWORD提供新的密碼，建立新的還原管理者。
DB_PATH=/var/lib/jplus-restore/jplus.sqlite node scripts/admin.js create-user recovery-admin admin '*'
```

還原的歷史帳號保留 ID，但全部停用且沒有可用密碼，避免把舊存取權一併恢復。新管理者設定各帳號密碼後再逐一啟用。停止舊服務、核對 PO／收付款／稽核後，才切換正式服務的 `DB_PATH`。

## 上線驗收與下一階段

本原型已測試功能行為，不代表公司上線已驗收。仍需在目標環境驗證 HTTPS、反向代理、真實多人瀏覽器操作、手機版、負載、服務重啟、主機備援及備份恢復；由 Hunter 確認角色名單與財務／覆核分工。

擴展到多服務實例或更高寫入量前，將資料存取層遷移 PostgreSQL，保留外鍵、唯一憑證、微元欄位、版本檢查及原子稽核；這項遷移尚未實作。Node 24 `node:sqlite` API 仍是 RC，升級 Node 小版本前應重跑測試。

官方限制：[Node SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)、[SQLite WAL](https://www.sqlite.org/wal.html)。WAL允許讀寫併行，但同一時間只有一個 writer，且不能使用跨主機網路檔案系統。
