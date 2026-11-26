# Changelog

What changed in each version of OpenWick. The section for a version is also the text of its
release on GitHub.

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
