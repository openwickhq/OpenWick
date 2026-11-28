# Contributing to OpenWick

Thanks for helping. OpenWick is an open-source charting platform for stocks, indices and crypto (the US, UK, Germany, Japan, Hong Kong and India) that runs on your own computer.

## Get it running

1. Install [Node.js](https://nodejs.org) 18 or newer. There is no `npm install`: the app has no dependencies.
2. Fork this repository, clone your fork, and in its folder run `npm start`. It opens at `http://localhost:3777`.
3. The desktop app: `npm run desktop` (downloads Electron the first time).

## Before you open a pull request

- Run `node scripts/check.js`. It runs the offline tests, checks the data sources and does a live smoke test. All of it must pass.
- Add or update a test in `test/` when you change behaviour.
- Keep each pull request to one change, and say in plain words what it does and why.
- Add your name to `AUTHORS` in your first pull request, if you want to be listed.

## Project rules

- **No runtime dependencies.** The app runs on plain Node.js. Talk to us in an issue first if something truly needs a library.
- **Free data by default.** The app must work with no account and no API key. Paid or keyed data sources are optional add-ons, and keys stay on the user's computer.
- **Your data stays local.** No tracking, no analytics, nothing sent anywhere except requests to the data sources.
- **No TradingView branding.** Don't use TradingView's name, logo or slogans in the app. (The Lightweight Charts library is credited as its licence asks.)
- **Plain language** in the interface and the docs.

## Good first contributions

Look for issues labelled `good first issue`. New indicators (see "Your own indicators" in the README), chart drawing tools and translations are good places to start.

## Licence

By contributing you agree that your work is released under the project's MIT licence (see `LICENSE`).
