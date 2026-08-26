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
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
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
    // 1. Fetch URL Utama
    const response = await axios.get(url, {
      maxRedirects: 5,
      headers: defaultHeaders,
      timeout: 8000,
      httpsAgent: httpsAgent,
      validateStatus: (status) => status < 500
    });

    if (response.status === 403) {
      return res.status(403).json({
        success: false,
        error: 'Website target dilindungi oleh proteksi keamanan (Status 403 Forbidden).'
      });
    }

    const finalUrl = response.request.res.responseUrl || url;
    const isRedirected = url.toLowerCase() !== finalUrl.toLowerCase();

    // 2. Parse HTML & Ambil Link Footer
    const $ = cheerio.load(response.data);
    let footerEl = $('footer, [class*="footer"], [id*="footer"]').first();
    const footerFound = footerEl.length > 0;
    let footerText = '';
    let rawLinks = [];

    if (footerFound) {
      footerText = footerEl.text().replace(/\s+/g, ' ').trim().slice(0, 300) + '...';

      footerEl.find('a').each((_, el) => {
        let href = $(el).attr('href');
        const text = $(el).text().trim();

        if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
          try {
            const absoluteUrl = new URL(href, finalUrl).href;
            rawLinks.push({
              text: text || 'Tanpa Teks',
              originalUrl: absoluteUrl
            });
          } catch (e) {}
        }
      });
    }

    // Ambil maksimal 10 link agar proses tidak terlalu berat
    const limitedRawLinks = rawLinks.slice(0, 10);

    // 3. CEK REDIRECT SETIAP LINK FOOTER SECARA REAL-TIME
    const footerLinksPromises = limitedRawLinks.map(async (item) => {
      try {
        const linkRes = await axios.get(item.originalUrl, {
          maxRedirects: 5,
          headers: defaultHeaders,
          timeout: 4000,
          httpsAgent: httpsAgent,
          validateStatus: (status) => status < 500
        });

        const linkFinalUrl = linkRes.request.res.responseUrl || item.originalUrl;
        const linkIsRedirected = item.originalUrl.toLowerCase() !== linkFinalUrl.toLowerCase();

        return {
          text: item.text,
          originalUrl: item.originalUrl,
          finalUrl: linkFinalUrl,
          isRedirected: linkIsRedirected,
          status: linkRes.status
        };
      } catch (err) {
        return {
          text: item.text,
          originalUrl: item.originalUrl,
          finalUrl: item.originalUrl,
          isRedirected: false,
          status: 'Error / Blocked'
        };
      }
    });

    // Jalankan semua pengecekan link secara paralel
    const checkedFooterLinks = await Promise.all(footerLinksPromises);

    return res.json({
      success: true,
      data: {
        initialUrl: url,
        finalUrl: finalUrl,
        isRedirected: isRedirected,
        statusCode: response.status,
        footerFound: footerFound,
        footerTextPreview: footerText,
        totalFooterLinks: rawLinks.length,
        footerLinks: checkedFooterLinks
      }
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: `Gagal mengakses URL target: ${error.message}`
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server berjalan di port ${PORT}`));

module.exports = app;
