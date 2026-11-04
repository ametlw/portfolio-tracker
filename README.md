# Portfolio Tracker

A personal portfolio tracker that runs locally on your own computer. Track crypto, stocks and options in one place, with live prices, P&L charts, a trading journal and an options P&L calculator.

Your data stays on your machine in a single JSON file. No account, no login, no API keys.

## Features

- **Overview:** total balance, net P&L, today's change, allocation by class or asset, P&L chart, intraday P&L, performance and drawdown, P&L contribution per holding.
- **Holdings:** Crypto / Stocks / Options tabs, each with its own summary, allocation and P&L chart. Click a card to open a detail panel:
  - the holding's own P&L since the first buy,
  - a candlestick chart (crypto from Binance, stocks from Yahoo; daily/weekly; older data loads as you scroll left) with buy/sell markers, average cost, take-profit and scaled-buy levels,
  - take-profit targets and scaled-buy plans ("I sold" / "I bought" buttons record the trade in one click),
  - trade history.
- **Options:** prices from the Yahoo option chain (bid/ask midpoint). An "unreliable price" badge appears when there is no bid or the spread is very wide. Expired options are closed automatically at intrinsic value.
- **Options calculator:** pick a symbol, put/call, expiration and strike (premium and IV are filled in); move the underlying price, date and IV sliders to see P&L until expiry, breakeven and probability of profit. Load your own positions with one click.
- **Watchlist:** what you want to buy, why, at what price, with an optional scaled-buy plan. "I bought" turns it into a holding.
- **Journal:** daily P&L on a calendar with weekly totals, best/worst day and a monthly returns table.
- **History:** every action with date and time, filterable and searchable.
- **Charts:** embedded TradingView with your own quick-access symbols and default indicators.
- **Live data:** crypto prices stream from OKX's public feed; stock pre-market/after-hours prices are shown separately. US market clock in the header, BTC / ETH / NQ1! / ES1! ticker strip at the bottom.
- **Share card:** a P&L image that shows percentages only and hides amounts.
- **Display currency:** USD, EUR, BTC, ETH or USDT from the menu at the top right. Past days use that day's exchange rate, so in BTC mode you see whether your portfolio grew in BTC terms, not just in dollars.
- Automatic daily backups (last 30 days), backup download and restore.

## Installation (Windows)

1. Install [Python 3.11 or newer](https://www.python.org/downloads/). On the first screen of the installer, tick **"Add python.exe to PATH"**.
2. Download this repository (**Code → Download ZIP**) and extract it to a permanent folder, e.g. `Documents\portfolio`.
3. Double-click **`start.bat`**. The first run installs the required packages (2–5 minutes), then the panel opens in your browser at <http://localhost:8765>.
4. Optional:
   - **`create_shortcut.bat`** puts a "Portfolio" icon on your desktop. The panel then opens in its own window without a console, and closing the window also stops the background server.
   - **`install_daily_task.bat`** creates a Windows scheduled task that saves the end-of-day snapshot every night at 00:30 (no admin rights needed). If your computer is off at that time, the panel fills in missed days from closing prices the next time you open it.

**macOS / Linux:**

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python server.py
```

## Getting started

1. Open **Settings** (gear icon, top right) and enter your **starting cash** and **start date**.
2. Add your positions under **Holdings → + Add**. For positions you already held before the start date, untick **"Deduct from cash"**.
3. Record money you add or take out with **Deposit / Withdraw**. These are not counted as profit or loss.

Symbol examples: crypto `BTC`, `ETH` (`-USD` is added automatically), stocks `AAPL`, `MSFT` (Yahoo Finance symbols).

## How P&L is calculated

- **Starting balance** = starting cash + cost of positions held before the start date. This is the zero point for P&L. It is computed automatically unless you enter a value in Settings.
- **P&L** = total balance − starting balance − (deposits − withdrawals).
- Costs use the weighted average method; the option multiplier is 100.
- Daily entries use closing prices. While the panel is open, today's entry is provisional; it becomes final from the nightly task (only after the 16:00 New York close) or from closing prices the next time you open the panel.

## Data and backups

- All data lives in `veri/veri.json`. A dated copy is saved to `veri/yedekler/` every day (last 30 days kept); restore any of them from Settings.
- **Settings → Download backup** exports everything as a single file.
- The `veri/` folder is excluded from git, so your data is never committed.

## If prices stop loading

Close the panel, double-click **`update.bat`** (updates the yfinance price library) and start the panel again. Yahoo occasionally changes its interface; an update usually fixes it.

## Security

The panel is meant to be used only on your own computer:

- The server listens on `127.0.0.1` only, so it is not reachable from your network.
- Requests with an unexpected `Host` header are rejected (protects against DNS rebinding).
- Write requests must be JSON and come from the panel's own origin (protects against other websites sending actions through your browser).
- A Content Security Policy and other security headers are sent with every response.
- No API keys, passwords or account data are needed or stored.

Do not expose the server to the internet or your local network (for example by changing the bind address to `0.0.0.0` or with port forwarding). See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Data sources

- Stocks, options, futures and FX: Yahoo Finance via [yfinance](https://github.com/ranaroussi/yfinance). Data may be delayed (futures about 10 minutes).
- Live crypto prices: OKX public WebSocket. Crypto candles, daily closes and previous close: Binance public API (not available from US IP addresses; Yahoo is used instead).

This tool is not investment advice. Prices and calculations may be wrong or delayed; always check figures with your broker.

## Built with

- [Flask](https://flask.palletsprojects.com/) (BSD-3-Clause)
- [yfinance](https://github.com/ranaroussi/yfinance) (Apache-2.0)
- [Chart.js](https://www.chartjs.org/) 4.4.1 (MIT), bundled as `static/chart.umd.min.js`
- [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts) 4.2.0 (Apache-2.0), bundled as `static/lightweight-charts.js`. The TradingView logo on charts is shown as required by its license.
- The Charts tab uses TradingView's free embedded widget.
