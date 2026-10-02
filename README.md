# AI Server 組裝廠最終佈置的全流程模擬

製造管理與決策 作業二（王建皓 113704062）的模擬視覺化網頁。20261003
畫面回放 Python／SimPy 離散事件模擬產生的事件紀錄：每一個點是一台 Server，所有搬運都沿著佈置中的通道行走。

##  GitHub Pages

網址是
https://dreyeki.github.io/ai_server_sim/
打開就能看到完整模擬

也可以直接用瀏覽器打開 `index.html` 即可（資料以 `data.js` 載入，不需要架伺服器）。

## 檔案

| 檔案 | 內容 |
|---|---|
| `index.html` | 網頁本體 |
| `style.css` | 樣式 |
| `app.js` | 回放引擎與繪圖（Canvas，無外部套件） |
| `data.js` | 模擬事件紀錄與月平均結果（由 `trace_sim.py` 產生） |

## 重新產生資料

在「模擬程式」資料夾（需 Python 3、`pip install simpy numpy`）：

```
python trace_sim.py
```

會重新跑三個情境（最終佈置・加開中班、最終佈置・單班、Layout A），並輸出 `web/data.js`。
