const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const Sentiment = require('sentiment');

const app = express();
app.use(express.json());
const sentiment = new Sentiment();
const START_PORT = Number(process.env.PORT || 3000);

// Serve static files
app.use(express.static(path.join(__dirname)));

// settings persistence
const SETTINGS_FILE = path.join(__dirname, 'settings.json');
async function readSettings(){
  try{ const txt = await fs.promises.readFile(SETTINGS_FILE,'utf8'); return JSON.parse(txt); }catch(e){ return {}; }
}
async function writeSettings(obj){
  try{ await fs.promises.writeFile(SETTINGS_FILE, JSON.stringify(obj, null, 2), 'utf8'); return true; }catch(e){ console.warn('Failed to write settings:', e.message); return false; }
}

// Mock data for demo purposes
function getMockData(symbol) {
  const mockQuotes = {
    'XAUUSD': { c: 4967.27, d: 178.27, dp: 3.71, pc: 4789.00 },        // Gold (forex) - CFD proxy
    'XAGUSD': { c: 76.895, d: 0.180, dp: 0.24, pc: 76.715 },           // Silver (forex) - CFD proxy
    '^DJI': { c: 50098.00, d: 1336.00, dp: 2.74, pc: 48762.00 },        // Dow 30 index - CFD proxy
    '^NDX': { c: 25033.96, d: 689.20, dp: 2.83, pc: 24344.76 },         // Nasdaq-100 index - CFD proxy
    '^GSPC': { c: 6928.14, d: 157.25, dp: 2.32, pc: 6770.89 },          // S&P 500 index - CFD proxy
    // Quick-fix: use broker-supplied visible values
    'GER40': { c: 24780.2, d: 327.9, dp: 1.34, pc: 24452.3 },           // Broker GER40 snapshot
    '^GDAXI': { c: 24780.2, d: 327.9, dp: 1.34, pc: 24452.3 },         // map GDAXI -> GER40
    'GER30': { c: 24780.2, d: 327.9, dp: 1.34, pc: 24452.3 },          // alias mapped to GER40
    'EURUSD=X': { c: 1.18149, d: 0.00375, dp: 0.32, pc: 1.17774 },      // EUR/USD broker snapshot
    'EURUSD': { c: 1.18149, d: 0.00375, dp: 0.32, pc: 1.17774 }         // alias
  };
  return mockQuotes[symbol] || { c: 100, d: 0, dp: 0, pc: 100 };
}

// symbol alias map: try these candidates when a symbol returns no data
const ALIASES = {
  '^GDAXI': ['^GDAXI','GER40','DE40','DAX','GER30'],
  'GER30': ['GER30','^GDAXI','GER40','DE40','DAX'],
  'EURUSD=X': ['EURUSD=X','EURUSD','EURUSD:CUR','EUR/USD'],
  'EUR/USD': ['EURUSD=X','EURUSD','EUR/USD']
};

// API endpoint to fetch quote data
app.get('/api/quote', async (req, res) => {
  const symbol = req.query.symbol;
  if (!symbol) {
    return res.status(400).json({ error: 'symbol query param required' });
  }

  const finnhubKey = process.env.FINNHUB_KEY;

  // build list of candidate symbols to try (preserve request as `symbol`)
  const settings = await readSettings();
  const mergedAliases = Object.assign({}, ALIASES, settings.aliases || {});
  const candidates = mergedAliases[symbol] || [symbol];

  // Try Finnhub if key is provided
  if (finnhubKey) {
    try {
      for (const cand of candidates) {
        const fhUrl = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(cand)}&token=${finnhubKey}`;
        const r = await fetch(fhUrl);
        const json = await r.json();
        if (json && json.c && json.c > 0) {
          console.log(`Finnhub success for ${symbol} (via ${cand}): ${json.c}`);
          return res.json({ finnhub: true, data: json, usedSymbol: cand });
        }
      }
      console.warn(`Finnhub returned zero/null for all candidates of ${symbol}, falling through`);
    } catch (err) {
      console.warn('Finnhub fetch failed:', err.message);
    }
  }

  // Fallback to mock data (Yahoo APIs require browser-only crumb token; skip for now)
  return res.json({ mock: true, data: getMockData(symbol) });
});

// News endpoint: returns recent headlines for a symbol
app.get('/api/news', async (req, res) => {
  const symbol = req.query.symbol;
  if (!symbol) return res.status(400).json({ error: 'symbol query param required' });
  const finnhubKey = process.env.FINNHUB_KEY;
  const newsApiKey = process.env.NEWSAPI_KEY;
  const fxFactoryRss = process.env.FXFACTORY_RSS; // optional RSS URL

  const candidates = ALIASES[symbol] || [symbol];

  // 1) Finnhub company-news
  if (finnhubKey) {
    try {
      const to = new Date();
      const from = new Date(Date.now() - 7 * 24 * 3600 * 1000);
      const toStr = to.toISOString().slice(0,10);
      const fromStr = from.toISOString().slice(0,10);
      for (const cand of candidates) {
        const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(cand)}&from=${fromStr}&to=${toStr}&token=${finnhubKey}`;
        const r = await fetch(url);
        const arr = await r.json();
        if (Array.isArray(arr) && arr.length>0) {
          const top = arr.slice(0,5).map(a=>({headline:a.headline, source:a.source, url:a.url, datetime:a.datetime}));
          return res.json({ provider: 'finnhub', data: top, usedSymbol: cand });
        }
      }
    } catch(e){ console.warn('Finnhub news failed:', e.message); }
  }

  // 2) NewsAPI.org (if API key provided)
  if (newsApiKey) {
    try {
      const q = encodeURIComponent(symbol);
      const url = `https://newsapi.org/v2/everything?q=${q}&pageSize=5&sortBy=publishedAt&apiKey=${newsApiKey}`;
      const r = await fetch(url);
      const j = await r.json();
      if (j && j.articles && j.articles.length>0) {
        const top = j.articles.map(a=>({headline:a.title, source: a.source&&a.source.name, url:a.url, datetime: a.publishedAt}));
        return res.json({ provider: 'newsapi', data: top });
      }
    } catch(e){ console.warn('NewsAPI fetch failed:', e.message); }
  }

  // 3) FXFactory RSS (if provided)
  if (fxFactoryRss) {
    try {
      const r = await fetch(fxFactoryRss);
      const txt = await r.text();
      // crude RSS parse: extract <item> titles and links
      const items = [];
      const itemRe = /<item[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<pubDate>([\s\S]*?)<\/pubDate>[\s\S]*?<\/item>/gi;
      let m;
      while((m = itemRe.exec(txt)) && items.length<5){
        items.push({ headline: m[1].replace(/<!\[CDATA\[|\]\]>/g,'').trim(), url: m[2].trim(), datetime: new Date(m[3].trim()).getTime() });
      }
      if (items.length>0) return res.json({ provider: 'fxfactory', data: items });
    } catch(e){ console.warn('FXFactory RSS failed:', e.message); }
  }

  // Fallback: small set of mock headlines
  const mockHeadlines = {
    'XAUUSD': [ {headline:'Gold gains as risk-off flows increase', source:'Macro Desk', url:'#', datetime: Date.now()-3600 } ],
    '^GDAXI': [ {headline:'European equities mixed amid economic data', source:'EU Markets', url:'#', datetime: Date.now()-3600 } ],
    'GER40': [ {headline:'GER40 up after strong tech earnings', source:'Broker News', url:'#', datetime: Date.now()-1800 } ],
    'EURUSD=X': [ {headline:'Euro strengthens on hawkish ECB signals', source:'FX News', url:'#', datetime: Date.now()-5400 } ]
  };
  return res.json({ provider: 'mock', data: mockHeadlines[symbol] || [] });
});

// Economic calendar endpoint: tries TradingEconomics if configured, otherwise returns mock events
app.get('/api/econ', async (req, res) => {
  const sourceUser = process.env.TRADINGECONOMICS_USER;
  const sourceKey = process.env.TRADINGECONOMICS_KEY;
  if (sourceUser && sourceKey) {
    try {
      // TradingEconomics calendar (requires credentials)
      const url = `https://api.tradingeconomics.com/calendar?cDate=1970-01-01&c=all&username=${encodeURIComponent(sourceUser)}&password=${encodeURIComponent(sourceKey)}`;
      const r = await fetch(url);
      const j = await r.json();
      if (Array.isArray(j)) return res.json({ provider: 'tradingeconomics', data: j.slice(0,20) });
    } catch(e){ console.warn('TradingEconomics fetch failed:', e.message); }
  }

  // Fallback mock economic events
  const mock = [
    { country: 'US', event: 'Nonfarm Payrolls', date: new Date(Date.now()+3600*24*1000).toISOString(), impact: 'High' },
    { country: 'EU', event: 'ECB Rate Decision', date: new Date(Date.now()+3600*48*1000).toISOString(), impact: 'High' },
    { country: 'US', event: 'FOMC Minutes', date: new Date(Date.now()+3600*72*1000).toISOString(), impact: 'Medium' }
  ];
  return res.json({ provider: 'mock', data: mock });
});

// Settings endpoints - simple file-backed persistence for API keys and aliases
app.get('/api/settings', async (req, res) => {
  const s = await readSettings();
  return res.json({ ok: true, data: s });
});

app.post('/api/settings', async (req, res) => {
  const body = req.body || {};
  // sanitize keys: only accept known props
  const allowed = ['finnhubKey','newsApiKey','tradingEconomicsUser','tradingEconomicsKey','fxFactoryRss','aliases'];
  const out = {};
  for(const k of allowed){ if(body[k]!==undefined) out[k]=body[k]; }
  const cur = await readSettings();
  const merged = Object.assign({}, cur, out);
  const ok = await writeSettings(merged);
  if(!ok) return res.status(500).json({ ok:false, error: 'failed to write settings' });
  return res.json({ ok:true, data: merged });
});

// ML Sentiment analysis endpoint - analyze text sentiment using pre-trained model
app.post('/api/sentiment', (req, res) => {
  const text = req.body.text || '';
  if(!text.trim()) return res.json({ score: 0, comparative: 0, tokens: [], words: [], negations: [] });
  
  try {
    const result = sentiment.analyze(text);
    // result: { score: -5..5, comparative: -5..5 (normalized), tokens: [...], words: [...], negations: [...] }
    return res.json({ 
      score: result.score,           // raw sentiment score
      comparative: result.comparative, // normalized (-1 to 1 scale)
      tokens: result.tokens,
      words: result.words,
      negations: result.negations
    });
  } catch(e) {
    console.warn('Sentiment analysis failed:', e.message);
    return res.status(500).json({ error: 'sentiment analysis failed' });
  }
});

// Listen with auto-retry on port conflict
function startServer(port, attemptsLeft) {
  const server = app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.warn(`Port ${port} in use, trying ${port + 1}`);
      startServer(port + 1, attemptsLeft - 1);
    } else {
      console.error('Failed to start server:', err.message);
      process.exit(1);
    }
  });
}

startServer(START_PORT, 10);
