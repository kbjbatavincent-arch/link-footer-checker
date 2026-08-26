const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server berjalan di port ${PORT}`));

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Agent untuk mengabaikan kendala sertifikat SSL pada situs tertentu
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Header standar browser agar tidak mudah diblokir bot protection
const defaultHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,id;q=0.8'
};

// Fungsi pembantu untuk mengecek status redirect satu URL
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
      error: null
    };
  } catch (error) {
    return {
      originalUrl: targetUrl,
      finalUrl: targetUrl,
      isRedirected: false,
      status: error.response ? error.response.status : 'Error',
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
    
    // 2. Ambil isi HTML dari URL akhir
    const response = await axios.get(mainCheck.finalUrl, {
      headers: defaultHeaders,
      timeout: 10000,
      httpsAgent: httpsAgent
    });

    // 3. Parse HTML & Cari Footer
    const $ = cheerio.load(response.data);
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

    // Batasi pengecekan maksimal 10 link footer
    const limitedLinks = rawFooterLinks.slice(0, 10);

    // 4. Cek Redirect setiap Link Footer Secara Paralel
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

    // 5. Kirim Respon
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
      error: `Gagal mengakses URL utama: ${error.message}`,
      details: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});