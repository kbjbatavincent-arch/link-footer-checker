const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');
const https = require('https');

const app = express();

app.use(cors());
app.use(express.json());
// Melayani file statis dari folder public
app.use(express.static(path.join(__dirname, 'public')));

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const defaultHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
  'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1'
};

async function checkUrlRedirect(targetUrl) {
  try {
    const response = await axios.get(targetUrl, {
      maxRedirects: 10,
      headers: defaultHeaders,
      timeout: 10000,
      httpsAgent: httpsAgent
    });

    const finalUrl = response.request.res.responseUrl || targetUrl;
    return {
      originalUrl: targetUrl,
      finalUrl: finalUrl,
      isRedirected: targetUrl.toLowerCase() !== finalUrl.toLowerCase(),
      status: response.status,
      data: response.data,
      error: null
    };
  } catch (error) {
    return {
      originalUrl: targetUrl,
      finalUrl: targetUrl,
      isRedirected: false,
      status: error.response ? error.response.status : 'Error',
      data: error.response ? error.response.data : null,
      error: error.message
    };
  }
}

// RUTE UTAMA (Menampilkan index.html)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API CHECK LINK
app.post('/api/check-link', async (req, res) => {
  let { url } = req.body;

  if (!url) {
    return res.status(400).json({ success: false, error: 'URL tidak boleh kosong.' });
  }

  if (!/^https?:\/\//i.test(url)) {
    url = 'http://' + url;
  }

  try {
    const mainCheck = await checkUrlRedirect(url);
    
    if (!mainCheck.data) {
      return res.status(mainCheck.status === 'Error' ? 500 : mainCheck.status).json({
        success: false,
        error: `Gagal mengakses URL utama (Status: ${mainCheck.status}). Situs memblokir permintaan.`,
        details: mainCheck.error
      });
    }

    const $ = cheerio.load(mainCheck.data);
    let footerEl = $('footer, [class*="footer"], [id*="footer"]').first();
    const footerFound = footerEl.length > 0;
    let footerText = '';
    let rawFooterLinks = [];

    if (footerFound) {
      footerText = footerEl.text().replace(/\s+/g, ' ').trim().slice(0, 300) + '...';

      footerEl.find('a').each((_, el) => {
        let href = $(el).attr('href');
        const text = $(el).text().trim();

        if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
          try {
            const absoluteUrl = new URL(href, mainCheck.finalUrl).href;
            rawFooterLinks.push({ text: text || 'Tanpa Teks', rawUrl: absoluteUrl });
          } catch (e) {}
        }
      });
    }

    const limitedLinks = rawFooterLinks.slice(0, 10);
    const checkedFooterLinks = await Promise.all(
      limitedLinks.map(async (item) => {
        const redirectResult = await checkUrlRedirect(item.rawUrl);
        return {
          text: item.text,
          originalUrl: item.rawUrl,
          finalUrl: redirectResult.finalUrl,
          isRedirected: redirectResult.isRedirected,
          status: redirectResult.status
        };
      })
    );

    res.json({
      success: true,
      data: {
        initialUrl: url,
        finalUrl: mainCheck.finalUrl,
        isRedirected: mainCheck.isRedirected,
        statusCode: mainCheck.status,
        footerFound: footerFound,
        footerTextPreview: footerText,
        totalFooterLinks: rawFooterLinks.length,
        footerLinks: checkedFooterLinks
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: `Terjadi kesalahan internal server: ${error.message}`
    });
  }
});

// Lokal Listener (untuk pengembangan lokal saja)
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server lokal berjalan di port ${PORT}`));
}

// WAJIB UNTUK VERCEL SERVERLESS
module.exports = app;