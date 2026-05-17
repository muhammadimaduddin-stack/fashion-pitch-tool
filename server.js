const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

const KEEPA_KEY = 'q2vptdtmldf43g99lc8rfpv1cjsbak945atih5kbpod1j8ifa4t45i7naivc8fau';
const GROQ_KEY = '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';

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', keepa: 'connected', groq: 'connected' });
});

// Keepa search
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
      image: p.imagesCSV ? `https://images-na.ssl-images-amazon.com/images/I/${p.imagesCSV.split(',')[0]}` : '',
      currentPrice: p.csv && p.csv[0] ? (p.csv[0][p.csv[0].length - 1] / 100).toFixed(2) : null,
      salesRank: p.salesRanks ? Object.values(p.salesRanks)[0] : null,
      rating: p.rating ? (p.rating / 10).toFixed(1) : null,
      reviewCount: p.reviewCount || 0,
      priceHistory: p.csv && p.csv[0] ? extractPriceHistory(p.csv[0]) : []
    }));
    res.json({ products });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Keepa single product
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
      image: p.imagesCSV ? `https://images-na.ssl-images-amazon.com/images/I/${p.imagesCSV.split(',')[0]}` : '',
      currentPrice: p.csv && p.csv[0] ? (p.csv[0][p.csv[0].length - 1] / 100).toFixed(2) : null,
      salesRank: p.salesRanks ? Object.values(p.salesRanks)[0] : null,
      rating: p.rating ? (p.rating / 10).toFixed(1) : null,
      reviewCount: p.reviewCount || 0,
      priceHistory: p.csv && p.csv[0] ? extractPriceHistory(p.csv[0]) : []
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GROQ AI
app.post('/api/groq', async (req, res) => {
  const { message, context } = req.body;
  if (!message) return res.status(400).json({ error: 'Missing message' });
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        messages: [
          { role: 'system', content: `You are a fashion product research assistant helping pitch Amazon products to a manager. Be concise, max 2-3 sentences. Context: ${JSON.stringify(context || {})}` },
          { role: 'user', content: message }
        ],
        max_tokens: 300,
        temperature: 0.7
      })
    });
    const data = await r.json();
    res.json({ reply: data.choices?.[0]?.message?.content || 'No response.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Price history helper
function extractPriceHistory(csv) {
  const points = [];
  for (let i = 0; i < csv.length - 1; i += 2) {
    if (csv[i + 1] > 0) points.push(Math.round(csv[i + 1] / 100));
  }
  const last12 = points.slice(-12);
  while (last12.length < 12) last12.unshift(last12[0] || 0);
  return last12;
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
