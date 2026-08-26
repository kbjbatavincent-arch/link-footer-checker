const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');
const https = require('https');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const defaultHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,id;q=0.8'
};

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/check-link', async (req, res) => {
  let { url } = req.body;

  if (!url) {
    return res.status(400).json({ success: false, error: 'URL tidak boleh kosong.' });
  }

  if (!/^https?:\/\//i.test(url)) {
    url = 'http://' + url;
  }

  try {
    const response = await axios.get(url, {
      maxRedirects: 5,
      headers: defaultHeaders,
      timeout: 5000,
      httpsAgent: httpsAgent
    });

    const finalUrl = response.request.res.responseUrl || url;
    const isRedirected = url.toLowerCase() !== finalUrl.toLowerCase();

    const $ = cheerio.load(response.data);
    let footerEl = $('footer, [class*="footer"], [id*="footer"]').first();
    const footerFound = footerEl.length > 0;
    let footerText = '';
    let footerLinks = [];

    if (footerFound) {
      footerText = footerEl.text().replace(/\s+/g, ' ').trim().slice(0, 300) + '...';

      footerEl.find('a').each((_, el) => {
        let href = $(el).attr('href');
        const text = $(el).text().trim();

        if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
          try {
            const absoluteUrl = new URL(href, finalUrl).href;
            footerLinks.push({
              text: text || 'Tanpa Teks',
              originalUrl: absoluteUrl,
              finalUrl: absoluteUrl,
              isRedirected: false,
              status: 200
            });
          } catch (e) {}
        }
      });
    }

    const limitedLinks = footerLinks.slice(0, 10);

    return res.json({
      success: true,
      data: {
        initialUrl: url,
        finalUrl: finalUrl,
        isRedirected: isRedirected,
        statusCode: response.status,
        footerFound: footerFound,
        footerTextPreview: footerText,
        totalFooterLinks: footerLinks.length,
        footerLinks: limitedLinks
      }
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: `Gagal mengakses URL target: ${error.message}`
    });
  }
});

// Listener lokal
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server lokal berjalan di port ${PORT}`));
}

// Module export wajib untuk Vercel Serverless
module.exports = app;