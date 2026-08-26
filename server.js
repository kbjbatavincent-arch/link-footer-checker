const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Header browser yang lebih lengkap untuk melewati proteksi 403
const defaultHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
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
    const isRedirected = targetUrl.toLowerCase() !== finalUrl.toLowerCase();

    return {
      originalUrl: targetUrl,
      finalUrl: finalUrl,
      isRedirected: isRedirected,
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

app.post('/api/check-link', async (req, res) => {
  let { url } = req.body;

  if (!url) {
    return res.status(400).json({ success: false, error: 'URL tidak boleh kosong.' });
  }

  if (!/^https?:\/\//i.test(url)) {
    url = 'http://' + url;
  }

  try {
    // 1. Cek Redirect URL Utama
    const mainCheck = await checkUrlRedirect(url);
    
    if (!mainCheck.data) {
      return res.status(mainCheck.status === 'Error' ? 500 : mainCheck.status).json({
        success: false,
        error: `Gagal mengakses URL utama (Status: ${mainCheck.status}). Situs tersebut memblokir permintaan otomatis.`,
        details: mainCheck.error
      });
    }

    // 2. Parse HTML & Cari Footer
    const $ = cheerio.load(mainCheck.data);
    let footerEl = $('footer');
    if (footerEl.length === 0) {
      footerEl = $('[id*="footer"], [class*="footer"]');
    }

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
          } catch (e) {
            // Abaikan URL tidak valid
          }
        }
      });
    }

    const limitedLinks = rawFooterLinks.slice(0, 10);

    // 3. Cek Redirect setiap Link Footer
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
      error: `Terjadi kesalahan internal server: ${error.message}`,
      details: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});