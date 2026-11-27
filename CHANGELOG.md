# Changelog

What changed in each version of OpenWick. The section for a version is also the text of its
release on GitHub.

## v0.3.0

### New

- **Six countries.** A country picker in the top bar (the globe): India, USA, UK, Japan, Germany and Hong Kong. The home page, Markets, Screener, Heatmap, News and the calendar show the picked market, with crypto on every country's pages. It's guessed from your time zone and remembered; a link with `?country=US` opens that market.
  - **USA:** S&P 500 + Nasdaq-100 (518 stocks), the S&P 500, Nasdaq, Dow Jones, Russell 2000 and VIX, and the 11 sector funds.
  - **UK:** FTSE 350, with the FTSE 100, FTSE 250 and All-Share.
  - **Japan:** Nikkei 225, with TOPIX.
  - **Germany:** DAX and MDAX, with the SDAX and TecDAX.
  - **Hong Kong:** the Hang Seng Index, with Hang Seng TECH and HS China Enterprises.
- **Every country gets every page:** movers and breadth, the screener with company figures, the heatmap by sector, stock pages (financials, peers, index weights, news), market news from local English sources, and its economic calendar (Fed, Bank of England, Bank of Japan, ECB, China).
- **Charts follow each exchange:** trading hours, Tokyo's and Hong Kong's lunch breaks, the bar countdown, live refresh and session shading come from the symbol's own exchange. Prices show in the right currency (pence for London shares).
- **Portfolio for any country:** any CSV with Symbol, Quantity and Average price columns (`NASDAQ:AAPL`, `SHEL.L`, `7203.T`, `SAP.DE`, `0700.HK`), or typed in. Countries can be mixed; totals are converted at today's rates, and your sectors are compared with the country's main index.
- **Watchlist files** read and write other exchanges' tickers (`NASDAQ:AAPL`, `LSE:SHEL`, `TSE:7203`, `XETR:SAP`, `HKEX:700`).

### How data is loaded

- The name lists for every country come with the app (about 150 KB in all), so search and switching are instant.
- A country's company figures and logos download in the background the first time you open it, and refresh weekly while you keep using it.
- A country not opened for 30 days has its figures and logos deleted; they come back the next time.
- Prices are never saved.

### Better

- **Search** finds stocks and indices from every country, and suggests the picked country's before you type.
- **Big numbers** read the way each country writes them: crore and lakh crore for India, millions and billions elsewhere.
- **Countdown on/off:** a clock button in the corner below the price scale shows or hides the countdown to the bar's close on every chart (also in Settings → Scales).

## v0.2.0

### New

- **Markets page** (`/markets`, Markets in the top bar), with two parts:
  - **Movers:** the full lists behind the home page's panels. Shows today's gainers and losers among the NIFTY 500 or within any of 34 indices (NIFTY 50, NIFTY BANK, NIFTY IT and others). Also lists every sector, broad-market and strategy index sorted by today's move, and for crypto the biggest coins, gainers and losers. Every column sorts.
  - **Breadth:** market breadth for any index: stocks up and down, 52-week highs and lows, the share above their 50- and 200-day averages, and sectors. Includes one table comparing every index.
- **Notes**, beside the chart and on their own page (`/notes`, the notes icon in the top bar):
  - Four kinds: trade ideas (entry, stop and target, with risk, reward and R:R worked out), investment theses (fair value and upside), journal entries and plain notes.
  - A note linked to a symbol shows how far the price has moved since you wrote it.
  - Pin, tag, search, filter and download notes as Markdown.
  - Notes are saved as you type, on your computer.
- **Your watchlist on the home page**, as a compact list with live prices that folds after nine symbols.

### Better

- **Live stock charts:** while NSE is open, Indian stock and index charts refresh every 2.5 seconds, and the current candle is built from minute data.
- **Top bar:** the chart button is now called Charts, Movers and Breadth share one Markets link, and Notes is an icon beside light/dark.
- **Dialogs:** confirmations, names and messages open in the app's own dialog instead of the browser's "localhost says" boxes. Deletes get a red button.
- **Dropdowns:** select boxes and the app's menus now share one design in both themes. Long choices end in "…".
- **Tables:** the Markets and Breadth tables fit the window, shortening long names and hiding the least important columns on smaller screens.
- **Watchlist panel:** the chart's side panel is labelled Watchlist, with the list name beside it.

### Fixed

- **Candles:** 5-minute and other intraday candles could show as thin lines that jumped forward during market hours until the page was reloaded.
- **Holidays:** charts no longer refresh at the fast market-hours rate on NSE holidays.

## v0.1.0

The first release.
