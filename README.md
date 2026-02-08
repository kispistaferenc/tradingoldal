# Fundamental AI Analyst — Trading Analytics Dashboard

A real-time trading fundamentals and AI-generated daily analysis tool for major financial instruments (GOLD, SILVER, USD30, NAS100, ES500, GER30, EUR/USD).

## Features

- **Live Market Data**: Multi-source (Finnhub, Yahoo) with automatic fallback
- **Daily AI Bios**: Summaries combining price momentum, news, and economic events
- **News Integration**: Headlines from Finnhub, NewsAPI, and FXFactory RSS
- **Economic Calendar**: High-impact events with volatility alerts
- **Confidence & Sentiment**: Visual bars and badges (Bullish/Bearish/Neutral)
- **Dark Responsive UI**: Built for traders on desktop or mobile
- **Symbol Aliasing**: Auto-maps broker-specific tickers

## Quick Start

### Option 1: Using Finnhub (Recommended)

Finnhub provides reliable, server-side access to real-time market data. A free tier is available.

1. Sign up for a free Finnhub API key: https://finnhub.io/
2. Install dependencies:

```bash
npm install
```

3. Start the server with your API key (PowerShell):

```powershell
$env:FINNHUB_KEY = 'your_finnhub_api_key_here'
npm start
```

Or (Command Prompt):

```cmd
set FINNHUB_KEY=your_finnhub_api_key_here
npm start
```

4. Open http://localhost:3000 (or the next available port if 3000 is busy) in your browser.

### Option 2: Using Yahoo Finance (Fallback)

If `FINNHUB_KEY` is not set, the server falls back to Yahoo Finance endpoints. Note: Yahoo Finance may return authorization errors for server-side requests, so Finnhub is preferred.

```bash
npm install
npm start
```

## How It Works

- Server (`server.js`) handles `/api/quote`, `/api/news`, `/api/econ`, `/api/sentiment` endpoints.
- **ML Sentiment Analysis**: Uses pre-trained AFINN model to score headline text -1 to +1.
- Headlines weighted by recency; older news counts less.
- Bias formula: Price momentum + weighted (ML headline sentiment) + econ calendar context.
- Supports Finnhub → Yahoo v10 → Yahoo v7 → Mock fallback.

## ML Sentiment API

The `/api/sentiment` endpoint provides ML-based text analysis:

```bash
curl -X POST http://localhost:3000/api/sentiment \
  -H "Content-Type: application/json" \
  -d '{"text":"Gold surges on strong economic data"}'

# Response: { score: 4, comparative: 0.667, ... }
```

Returns: `score` (raw -∞..+∞), `comparative` (-1..+1 normalized), `tokens`, `words`.

## Notes

- ML sentiment model is lightweight and runs server-side (no external API calls).
- Finnhub API key recommended for best data coverage.
- Works offline with fallback mock data.
