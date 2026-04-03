const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const axios = require('axios');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

const pool = mysql.createPool({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: Number(process.env.MYSQLPORT),
  waitForConnections: true,
  connectionLimit: 10,
});

let browser;

// --------------------
// Start server + browser
// --------------------
async function startServer() {
  browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ]
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// --------------------
// Helpers
// --------------------
async function getPage() {
  const page = await browser.newPage();

  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
  );

  await page.setViewport({ width: 1280, height: 800 });

  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://anime3rb.com/',
  });

  return page;
}

// --------------------
// Routes
// --------------------

app.get("/", (req, res) => {
  res.send("<h1>Anime API Running 🚀</h1>");
});

// --------------------
// Latest Animes
// --------------------
app.get('/getLatestAnimes', async (req, res) => {
  if (!browser) return res.status(503).json({ error: 'Browser not ready' });

  let page;
  try {
    const pageNum = parseInt(req.query.page) || 1;
    const url = `https://anime3rb.com?page=${pageNum}`;

    page = await getPage();

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('#videos > div.my-2', { timeout: 10000 });

    const animeList = await page.evaluate(() => {
      const list = [];

      document.querySelectorAll('#videos > div.my-2').forEach(el => {
        const poster = el.querySelector('img')?.src || null;
        const title = el.querySelector('h3.title-name')?.textContent.trim() || null;
        const episodeName = el.querySelector('p.number')?.textContent.trim() || null;
        const episodeHref = el.querySelector('a')?.href || null;

        let animeId = null;
        if (episodeHref) {
          const parts = episodeHref.split('/');
          animeId = parts[parts.length - 2];
        }

        list.push({ animeId, poster, title, episodeName, episodeHref });
      });

      return list;
    });

    res.json({ animeList });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    if (page) await page.close();
  }
});

// --------------------
// Episode Source
// --------------------
app.get('/getEpisodeSource', async (req, res) => {
  if (!browser) return res.status(503).json({ error: 'Browser not ready' });

  let page;
  try {
    const episodeHref = req.query.episodeHref;
    if (!episodeHref) return res.status(400).json({ error: 'episodeHref required' });

    page = await getPage();

    await page.goto(episodeHref, { waitUntil: 'networkidle2' });
    await page.waitForSelector('iframe', { timeout: 10000 });

    const iframe = await (await page.$('iframe')).contentFrame();

    await iframe.waitForSelector('video', { timeout: 10000 });

    const episodeSrc = await iframe.$eval('video', el => el.src);

    res.json({ episodeSrc });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    if (page) await page.close();
  }
});

// --------------------
// Anime Info
// --------------------
app.get('/getAnimeInfo', async (req, res) => {
  if (!browser) return res.status(503).json({ error: 'Browser not ready' });

  let page;
  try {
    const animeId = req.query.animeId;
    if (!animeId) return res.status(400).json({ error: 'animeId required' });

    const url = `https://anime3rb.com/titles/${animeId}`;
    page = await getPage();

    await page.goto(url, { waitUntil: 'networkidle2' });
    await page.waitForSelector('h1', { timeout: 10000 });

    const animeInfo = await page.evaluate(() => {
      const text = s => document.querySelector(s)?.textContent.trim() || '';

      return {
        title: text('h1 span'),
        poster: document.querySelector('img')?.src || null,
        state: text('table tr:nth-child(1) td:nth-child(2)'),
        rating: text('p.text-lg'),
        desc: Array.from(document.querySelectorAll('p'))
          .map(p => p.textContent.trim())
          .join(' ')
      };
    });

    res.json({ animeInfo });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    if (page) await page.close();
  }
});

// --------------------
// Episodes List
// --------------------
app.get('/getAnimeEpisodesInfo', async (req, res) => {
  if (!browser) {
    return res.status(503).json({ error: 'Puppeteer browser not initialized yet' });
  }

  let episodeHref = req.query.episodeHref;
  if (!episodeHref) {
    return res.status(400).json({ error: 'episodeHref is required' });
  }

  let page;

  try {
    // 🔥 Convert episode URL → anime page URL
    if (episodeHref.includes('/episode/')) {
      const parts = episodeHref.split('/');
      const animeSlug = parts[parts.length - 2]; // kimetsu-no-yaiba

      episodeHref = `https://anime3rb.com/titles/${animeSlug}`;
    }

    page = await getPage();

    await page.goto(episodeHref, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    // ✅ Wait properly (NO more timeout issue)
    await page.waitForSelector('div.video-list a', { timeout: 15000 });

    const animeList = await page.evaluate(() => {
      const list = [];
      let animeIdx = 0;

      document.querySelectorAll('div.video-list a').forEach(el => {
        const episodeNameEl = el.querySelector('div.video-data span');
        const episodeName = episodeNameEl ? episodeNameEl.textContent.trim() : '';

        const href = el.href;

        const episodeDescEl = el.querySelector('div.video-data > p');
        const episodeDesc = episodeDescEl ? episodeDescEl.textContent.trim() : '';

        animeIdx++;

        list.push({
          episodeName,
          episodeHref: href,
          episodeDesc,
          animeIdx
        });
      });

      return list;
    });

    res.json({ animeList });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  } finally {
    if (page) await page.close();
  }
});

// --------------------
// Shutdown
// --------------------
process.on('SIGINT', async () => {
  if (browser) await browser.close();
  process.exit();
});

process.on('SIGTERM', async () => {
  if (browser) await browser.close();
  process.exit();
});
