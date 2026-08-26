const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');
const https = require('https');

const app = express();

app.use(cors());
app.use(express.json());

// Menyajikan file statis dari folder public
app.use(express.static(path.join(__dirname, 'public')));

// Mengabaikan error sertifikat SSL jika ada
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Header disesuaikan agar menyerupai browser Google Chrome asli (Mencegah Error 403)
const defaultHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Ch-Ua': '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1'
};

// Rute Halaman Utama
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API Endpoint Pengecekan Link & Footer
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
      timeout: 8000,
      httpsAgent: httpsAgent,
      validateStatus: (status) => status < 500 // Izinkan menangkap status 403/404 tanpa throw exception
    });

    if (response.status === 403) {
      return res.status(403).json({
        success: false,
        error: 'Website target dilindungi oleh proteksi keamanan/Cloudflare sehingga menolak akses otomatis (Status 403 Forbidden).'
      });
    }

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

// Listener Port (Dukungan Render, Railway, Vercel & Lokal)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server berjalan di port ${PORT}`);
});

module.exports = app;
