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
- **First-run setup:** the first time OpenWick opens (desktop app or browser), it asks which markets you follow (India, USA, UK, Japan, Germany, Hong Kong and crypto; tick any) and which is home, with your time zone's market ticked already. Each market gets a starter watchlist: its main indices, its five biggest companies by market cap, its currency and gold; crypto gets the big coins. The first chart opens on the home market's main index. The choice is saved in the data folder, so the desktop app and a browser agree. Settings → General → Markets runs it again (adding lists, never replacing yours). People already using OpenWick never see it.
- **Market dot in the chart's top bar:** green while the chart's market is open, red while it's closed (crypto is always open; forex closes for the weekend). Hover for when it opens or closes; click for every market at a glance. The country menu's dots are red for closed markets too.

### How data is loaded

- The name lists for every country come with the app (about 150 KB in all), so search and switching are instant.
- A country's company figures and logos download in the background the first time you open it, and refresh weekly while you keep using it.
- A country not opened for 30 days has its figures and logos deleted; they come back the next time.
- Prices are never saved.

### Better

- **Search** finds stocks and indices from every country, and suggests the picked country's before you type.
- **Big numbers** read the way each country writes them: crore and lakh crore for India, millions and billions elsewhere.
- **Script editor, full screen:** write indicators and strategies in JavaScript with line numbers, highlighting, a console that names the line of an error, and a live preview on the active chart's bars (lines, markers, inputs to try, and a strategy's backtest). Start from six templates. Strategies written in code show in the Strategy tester under "Written in code". The Strategy tester itself has a full-screen button too.
- **More shortcuts:** Alt + a letter for 23 drawing tools (Alt+D pen, Alt+Y ray, Alt+P pitchfork, Alt+L long position…), Alt+A alert, / indicators, Ctrl+D clone, Ctrl+C and Ctrl+V copy a drawing to any chart, arrow keys to move a drawing, Alt+Shift+H hide all drawings, Alt+Shift+L lock them, Alt+Shift+S chart image. Press ? for the list.
- **Indicators on a higher timeframe:** Timeframe is now the first setting in every indicator's Inputs, with every common timeframe from 3 minutes to 1 month (only those above the chart's). The daily 200 EMA on a 15-minute chart matches the daily chart exactly, and history never peeks ahead.
- **Divergences on RSI and MACD:** Settings → Divergences: Regular, or Regular and hidden. Lines on the oscillator between the two pivots, arrows on the candles, and a signal output for alerts and the strategy tester.
- **VWAP bands:** one, two or three standard deviations around the VWAP (one by default), reset with each session.
- **Relative Volume (RVOL):** intraday, the session's volume so far against the usual volume by the same time of day; on daily bars, each bar against the average of the ones before. Bars from 2× are highlighted.
- **Auto Fib Retracement:** the last swing's Fibonacci levels (0 to 1, extensions optional), labelled on the price scale and redrawn as new swings form.
- **Auto Trendlines:** support and resistance through recent pivots, the newest unbroken ones running to the last bar, with "B" arrows where lines were broken and a break signal for alerts.
- **Company metrics on the chart for every country:** the 21 Fundamentals metrics (revenue, EPS, market cap, P/E…) now work for US, UK, Japanese, German and Hong Kong stocks too, in each company's own currency ($114B, £207B, ¥39.86T; crore for India). London prices in pence are handled.
- **Calendars for every country:** the USA, UK, Germany (euro area), Japan and Hong Kong (China) now list central-bank decisions from each bank's published schedule (Fed, Bank of England, ECB, Bank of Japan, China's Loan Prime Rate) and their index expiries, as well as the week's data, so they're never empty at a weekend. The chart's Calendar panel has all six countries.
- **No India default for the rest of the world:** a first visit picks the nearest of the six markets by time zone (the USA when none is near).
- **Fixes:** Breadth no longer says "NIFTY 500" for other countries; Japan's and other countries' news leave out Indian outlets and non-English headlines, and a failed news top-up is retried within a minute; a Hong Kong home tile with one price point no longer breaks its sparkline; US stock pages show volume as a whole number and market cap as $5.21T; the portfolio's quantities use the right digit grouping; the README no longer says "India first". Only one top-bar menu opens at a time (several could stay open together), and clicking Layouts again closes its menu.
- **Top bar always fits:** no more sideways scrolling. In a narrower window some labels become icons, then the least-used buttons move into a "More" (⋯) menu at the right end.
- **Price in the browser tab:** the tab shows the chart's symbol, last price and today's change (for example "RELIANCE 1,382.60 ▼ −0.97%"), updated live.
- **Shorter right-click menu:** at most 10 rows on the chart (alert, horizontal line or copy at the price, paste, indicators, hide or remove drawings, remove indicators, settings) and 8 on a drawing.
- **Script editor, redesigned:** one clean top bar (Scripts menu, name, Run, Save, Add to chart), the code on the left and the preview on the right, each in its own box so nothing overlaps; errors show under the code with a "Go to line" button; the preview can be resized or hidden, and moves under the code in a narrow window.
- **Fold the indicator list:** a small arrow under the symbol name hides the indicator names on the chart (it then shows how many there are) and brings them back.
- **Smoother pen:** freehand strokes keep every mouse sample at its exact position (they used to step from candle to candle) and are drawn as smooth curves.
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
