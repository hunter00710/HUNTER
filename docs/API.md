# API 與資料模型

同源 JSON API。未登入回 401、權限／CSRF 不符回 403、版本衝突回 409、資料不符回 422。寫入必須同時提供與 `APP_ORIGIN` 相符的 `Origin`、Session Cookie 及 `X-CSRF-Token`；不提供跨站 CORS。

## 端點

| 方法／路徑 | 功能 |
|---|---|
| POST `/api/login` | `{login,password}`；回傳角色、範圍、CSRF，Cookie 為 HttpOnly |
| POST `/api/logout` | 作廢目前 Session |
| GET `/api/me` | 目前帳號及 PO 範圍 |
| GET `/api/revision` | 共用資料修訂號，供15秒輪詢 |
| GET `/api/snapshot` | 全公司 V4 原表、工作台、紀錄版本；局部範圍及 sales 禁止 |
| GET `/api/orders[/PO]` | 僅回傳授權 PO 的必要欄位與版本 |
| GET `/api/payables[/ID]` | 應付來源 `source`、工作台覆寫 `data`、紀錄版本；依來源與覆寫合併讀取原幣基準 |
| GET `/api/plans[/ID]` | AR／AP 計畫與版本 |
| GET `/api/receipts[/ID]` | 收款與多 PO 分配 |
| GET `/api/payments[/ID]` | 付款與應付關聯 |
| GET `/api/reviews[/ID]` | 財務核對紀錄 |
| POST `/api/{plans,receipts,payments,payables}` | `{version:0,data:{id,...}}`；新紀錄 |
| PATCH `/api/{orders,payables,plans,receipts,payments,reviews}/ID` | `{version,data}`；完整工作台覆寫值，經後端驗證 |
| POST `/api/changes` | `{changes:[{collection,id,version,data}]}`；1至300筆原子批次 |
| GET `/api/audit` | 管理／覆核可讀最近200筆與完整雜湊鏈驗證結果 |
| GET `/api/backup` | 全公司 admin／finance 可匯出；記錄匯出行為 |
| GET／POST `/api/users` | 管理者列出／開通帳號 |
| PATCH `/api/users/ID` | `{version,role?,scope?,active?,password?}`；重設密碼或改權會撤銷所有 Session |

`orders` API 維護既有來源 PO，沒有建立新 PO 的匯入／合約核准流程；新合約應作為下一階段擴充，不能透過此 API 偽造來源快照。成功批次回傳新 revision 與紀錄版本。相同請求重送不會重複入帳：版本與唯一憑證會拒絕重複；尚未實作可回放原成功回應的 Idempotency-Key。

## 核銷範例（全為合成資料）

```json
{
  "changes": [{
    "collection": "receipts",
    "id": "REC-DEMO-1",
    "version": 0,
    "data": {
      "id": "REC-DEMO-1",
      "date": "2026-10-29",
      "ref": "SYNTHETIC-BANK-1",
      "bank": 1550,
      "tax": 50,
      "fee": 0,
      "verified": false,
      "evidence": "合成資料測試",
      "allocations": [
        {"po":"DEMO-001","net":1000,"invoice":"","planId":""},
        {"po":"DEMO-002","net":500,"invoice":"","planId":""}
      ]
    }
  }]
}
```

金額數值不得為字串；零額要填 `0`，未知基準為 `null`。憑證不可空白或有前後空白。已登錄交易的金額、日期、憑證與分配不可原地修改；只可帶版本作廢，或由另一名覆核人更改 `verified` 與證據。銀行核銷差額容許值沿用 V4 的0.005元；新增核銷不可超過正餘額。

新輸入最多六位小數、單一金額絕對值上限十億元。來源原有循環小數保留於原始 JSON 與原引擎顯示，資料庫索引金額欄四捨五入到微元；不把來源尾差默默調成零。

## 關聯與原始快照

`orders`、`payables` 保留不可改寫的來源 JSON 與工作台覆寫值；`plans` 以 PO 或應付 ID 外鍵連結；`receipts` 一對多 `allocations`，每筆核銷連到 PO 及可選的 AR 期款；`payments` 連到應付項目。交易的登錄人以外鍵連到 `users`。

`settings` 保存既有預測、投資與模型輸入，`reviews` 保存原核對事項與任務。`documents` 保存受登入保護的 V4 頁面及來源檔案指紋，`audit` 記錄真正的伺服器異動；V4 原有前端操作紀錄不當成伺服器稽核證據。

資料庫每筆紀錄有版本，交易與稽核在同一個 `BEGIN IMMEDIATE` 內提交。衝突不會部分成功，也不會把失敗批次寫成成功稽核。稽核鏈及禁止刪改觸發器不等於外部簽章封存；持有主機或資料庫管理權限的人仍可能整庫改寫。
