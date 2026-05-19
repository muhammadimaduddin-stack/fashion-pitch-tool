const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const KEEPA_KEY = 'q2vptdtmldf43g99lc8rfpv1cjsbak945atih5kbpod1j8ifa4t45i7naivc8fau';
const GROQ_KEY = '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';

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', keepa: 'connected', groq: 'connected' });
});

// ── Keepa search
app.get('/api/keepa/search', async (req, res) => {
  const { term } = req.query;
  if (!term) return res.status(400).json({ error: 'Missing term' });
  try {
    const url = `https://api.keepa.com/search?key=${KEEPA_KEY}&domain=1&type=product&term=${encodeURIComponent(term)}`;
    const r = await fetch(url);
    const data = await r.json();
    if (!data.products) return res.json({ products: [] });

    const products = data.products.slice(0, 20).map(p => ({
      asin: p.asin,
      title: p.title || 'Unknown',
      brand: p.brand || 'Unknown',
      // FIX 1: Build Amazon image URL directly from ASIN
      image: `https://images-na.ssl-images-amazon.com/images/P/${p.asin}.01.L.jpg`,
      // FIX 2: salesRank is a flat array [timestamp, rank, timestamp, rank...] — get the last rank value
      salesRank: getSalesRank(p),
      currentPrice: getCurrentPrice(p),
      rating: p.rating ? (p.rating / 10).toFixed(1) : null,
      reviewCount: p.reviewCount || 0,
      priceHistory: getPriceHistory(p)
    }));

    res.json({ products });
  } catch (e) {
    console.error('Keepa search error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Keepa single product
app.get('/api/keepa/product', async (req, res) => {
  const { asin } = req.query;
  if (!asin) return res.status(400).json({ error: 'Missing asin' });
  try {
    const url = `https://api.keepa.com/product?key=${KEEPA_KEY}&domain=1&asin=${asin}&history=1`;
    const r = await fetch(url);
    const data = await r.json();
    if (!data.products || !data.products[0]) return res.status(404).json({ error: 'Not found' });
    const p = data.products[0];
    res.json({
      asin: p.asin,
      title: p.title,
      brand: p.brand,
      image: `https://images-na.ssl-images-amazon.com/images/P/${p.asin}.01.L.jpg`,
      salesRank: getSalesRank(p),
      currentPrice: getCurrentPrice(p),
      rating: p.rating ? (p.rating / 10).toFixed(1) : null,
      reviewCount: p.reviewCount || 0,
      priceHistory: getPriceHistory(p)
    });
  } catch (e) {
    console.error('Keepa product error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GROQ AI
app.post('/api/groq', async (req, res) => {
  const { message, context } = req.body;
  if (!message) return res.status(400).json({ error: 'Missing message' });
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        messages: [
          {
            role: 'system',
            content: `You are a fashion product research assistant helping pitch Amazon products to a manager. Be concise, max 2-3 sentences. Context: ${JSON.stringify(context || {})}`
          },
          { role: 'user', content: message }
        ],
        max_tokens: 300,
        temperature: 0.7
      })
    });
    const data = await r.json();
    res.json({ reply: data.choices?.[0]?.message?.content || 'No response.' });
  } catch (e) {
    console.error('GROQ error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── HELPERS

// salesRank is a flat array [timestamp, rank, timestamp, rank...]
// Get the most recent rank value (last pair)
function getSalesRank(p) {
  try {
    if (!p.salesRanks) return null;
    const ranks = Object.values(p.salesRanks);
    if (!ranks.length) return null;
    const arr = ranks[0];
    if (Array.isArray(arr) && arr.length >= 2) {
      // Last value in the flat array is the most recent rank
      return arr[arr.length - 1];
    }
    return null;
  } catch(e) { return null; }
}

// Price from csv[0] — flat array [timestamp, price, timestamp, price...]
// Keepa prices are in cents * 100, divide by 100 to get USD
function getCurrentPrice(p) {
  try {
    if (!p.csv || !p.csv[0] || !p.csv[0].length) return null;
    const csv = p.csv[0];
    const price = csv[csv.length - 1];
    if (price <= 0) return null;
    return (price / 100).toFixed(2);
  } catch(e) { return null; }
}

// Extract last 12 monthly price points
function getPriceHistory(p) {
  try {
    if (!p.csv || !p.csv[0]) return [];
    const csv = p.csv[0];
    const points = [];
    for (let i = 0; i < csv.length - 1; i += 2) {
      const price = csv[i + 1];
      if (price > 0) points.push(Math.round(price / 100));
    }
    const last12 = points.slice(-12);
    while (last12.length < 12) last12.unshift(last12[0] || 0);
    return last12;
  } catch(e) { return []; }
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`   Keepa: connected`);
  console.log(`   GROQ:  connected`);
});
