const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const axios = require('axios');
const chromium = require('chrome-aws-lambda');

let connection;



const pool = mysql.createPool({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: Number(process.env.MYSQLPORT),  // ✅ convert to number
  waitForConnections: true,
  connectionLimit: 10,
});





const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

app.get("/image-proxy", async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).send("url query param required");

    // Basic URL validation
    try {
      new URL(url);
    } catch {
      return res.status(400).send("Invalid URL");
    }

    // Fetch image with browser-like headers
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept':
          'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://anime3rb.com/',
        'Connection': 'keep-alive'
      },
      timeout: 10000 // 10 seconds
    });

    const contentType = response.headers['content-type'] || 'image/jpeg';
    const buffer = Buffer.from(response.data, 'binary');

    res.set({
      "Content-Type": contentType,
      "Content-Length": buffer.length,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=86400" // cache 1 day
    });

    res.send(buffer);

  } catch (err) {
    console.error('Image proxy error:', err.message);
    if (err.response) {
      res.status(err.response.status).send(`Failed to fetch image: ${err.response.status}`);
    } else {
      res.status(500).send("Server error fetching image");
    }
  }
});


let browser;

app.listen(PORT, "0.0.0.0", async () => {
  console.log(`Server running on port ${PORT}`);

  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH || undefined,
      args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ],
    });

    console.log('✅ Puppeteer browser launched');
  } catch (err) {
    console.error('❌ Puppeteer failed:', err);
  }
});


// Helper to open a new page with common setup
let browserLaunchPromise;

async function getPage() {
  if (!browser || !browser.isConnected()) {
    if (!browserLaunchPromise) {
      browserLaunchPromise = puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath,
        headless: chromium.headless,
      }).then(b => {
        browser = b;
        browserLaunchPromise = null;  // reset once done
        return b;
      }).catch(err => {
        browserLaunchPromise = null;  // reset on failure to allow retry
        throw err;
      });
    }
    await browserLaunchPromise;
  }

  const page = await browser.newPage();

  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1280, height: 800 });
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://anime3rb.com/',
  });

  return page;
}



// GET latest animes
// GET latest animes
app.get('/getLatestAnimes', async (req, res) => {
  if (!browser) {
    return res.status(503).json({ error: 'Puppeteer browser not initialized yet' });
  }
  const pageNum = parseInt(req.query.page) || 1;
  const url = `https://anime3rb.com?page=${pageNum}`;
  try {
    const page = await getPage();
    await page.goto(url, { timeout: 0 });
    // Evaluate inside page context
    await new Promise(resolve => setTimeout(resolve, 3000));

    const animeList = await page.evaluate(() => {
      const list = [];
      document.querySelectorAll('#videos > div.my-2').forEach(el => {
        const posterEl = el.querySelector('a > div.poster > img');
        const poster = posterEl ? posterEl.src : null;

        const titleEl = el.querySelector('a h3.title-name');
        const title = titleEl ? titleEl.textContent.trim() : null;

        const episodeNameEl = el.querySelector('a p.number');
        const episodeName = episodeNameEl ? episodeNameEl.textContent.trim() : null;

        const anchor = el.querySelector('a');
        const episodeHref = anchor ? anchor.href : null;

        let animeId = null;
        if (episodeHref) {
          const parts = episodeHref.split('/');
          animeId = parts[parts.length - 2];
        }

        let numberOfEpisodes = null;
        if (episodeName) {
          const numStr = episodeName.replace('الحلقة', '').trim();
          numberOfEpisodes = parseInt(numStr);
        }

        list.push({ animeId, poster, title, episodeName, episodeHref, numberOfEpisodes });
      });
      return list;
    });

    await page.close();
    res.json({ animeList });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// GET episode source
app.get('/', async (req, res) => {
 
  try {
    // You can include any async logic here if needed
    res.send('<h1>Welcome to Anime API</h1>');
  } catch (error) {
    res.status(500).send(`<h1>Error: ${error.message}</h1>`);
  }
});






app.get('/getEpisodeSource', async (req, res) => {
  if (!browser) {
    return res.status(503).json({ error: 'Puppeteer browser not initialized yet' });
  }
  const episodeHref = req.query.episodeHref;
  if (!episodeHref) return res.status(400).json({ error: 'episodeHref is required' });

  try {
    const page = await getPage();
    await page.goto(episodeHref, { waitUntil: 'domcontentloaded' });

    // Wait for the iframe containing the video to load
    await page.waitForSelector('iframe', { timeout: 0 });

    // Get the iframe element
    const iframeHandle = await page.$('iframe');
    const iframe = await iframeHandle.contentFrame();

    // Wait for the video element within the iframe
    await iframe.waitForSelector('video#video_html5_api.vjs-tech', { timeout: 0 });

    // Extract the video source URL
    const episodeSrc = await iframe.$eval('video#video_html5_api.vjs-tech', el => el.getAttribute('src'));

    await page.close();

    if (!episodeSrc) {
      return res.status(404).json({ error: 'Video source not found' });
    }

    res.json({ episodeSrc });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// GET anime info
app.get('/getAnimeInfo', async (req, res) => {
   if (!browser) {
    return res.status(503).json({ error: 'Puppeteer browser not initialized yet' });
  }
  const animeId = req.query.animeId;
  if (!animeId) return res.status(400).json({ error: 'animeId is required' });

  try {
    const url = `https://anime3rb.com/titles/${animeId}`;
    const page = await getPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    const animeInfo = await page.evaluate(() => {
      const getText = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.textContent.trim() : '';
      };

      const posterEl = document.querySelector('section:nth-child(1) img');

      const poster = posterEl ? posterEl.src : null;

      const state = getText('table tr:nth-child(1) td:nth-child(2)');
      const isdar = getText('table tr:nth-child(2) td:nth-child(2)');
      const studioEl = document.querySelector('table tr:nth-child(3) td:nth-child(2) a');
      const studio = studioEl ? studioEl.textContent.trim() : '';

      const directorEls = document.querySelectorAll('table tr:nth-child(4) td.px-6.py-2:nth-child(2) a');
const seen = new Set();
const director = [];

directorEls.forEach(el => {
  const name = el.textContent.trim();
  if (!seen.has(name)) {
    seen.add(name);
    director.push(name);
  }
});


      const editorEl = document.querySelector('table tr:nth-child(5) td:nth-child(2) a');
      const editor = editorEl ? editorEl.textContent.trim() : '';

      const rating = getText('div.flex.flex-wrap.justify-between > div:nth-child(1) p.text-lg');
      const classAge = getText('div.flex.flex-wrap.justify-between > div:nth-child(3) p.text-lg');
      const title = getText('h1 > span:nth-child(1)');

      const descEls = document.querySelectorAll('div.py-4.flex.flex-col.gap-2 > p');
      const desc = Array.from(descEls)
        .map(p => p.textContent.trim())
        .filter(t => t.length > 0)
        .join(' ');

      const genreEls = document.querySelectorAll('div.flex.flex-wrap.gap-2.lg\\:gap-4.text-sm a');
      const genres = Array.from(genreEls).map(el => el.textContent.trim()).filter(g => g);

      return { title, poster, state, isdar, studio, director, editor, rating, classAge, genres, desc };
    });

    await page.close();
    res.json({ animeInfo });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



// GET anime episodes list
app.get('/getAnimeEpisodesInfo', async (req, res) => {
   if (!browser) {
    return res.status(503).json({ error: 'Puppeteer browser not initialized yet' });
  }
  const episodeHref = req.query.episodeHref;
  if (!episodeHref) return res.status(400).json({ error: 'episodeHref is required' });

  try {
    const page = await getPage();
    await page.goto(episodeHref, { waitUntil: 'domcontentloaded' });

    const animeList = await page.evaluate(() => {
      const list = [];
      let animeIdx = 0
      document.querySelectorAll('div.video-list a').forEach(el => {
        const episodeNameEl = el.querySelector('div.video-data span');
        const episodeName = episodeNameEl ? episodeNameEl.textContent.trim() : '';

        const href = el.href;

        const episodeDescEl = el.querySelector('div.video-data > p');
        const episodeDesc = episodeDescEl ? episodeDescEl.textContent.trim() : '';
        animeIdx+=1
        list.push({ episodeName, episodeHref: href, episodeDesc ,animeIdx});
      });
      return list;
    });

    await page.close();
    res.json({ animeList });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



app.get('/search', async (req, res) => {
  if (!browser) return res.status(503).json({ error: 'Puppeteer not ready' });
  const q = req.query.q;
  if (!q) return res.status(400).json({ error: 'q is required' });

  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.query(
      "SELECT * FROM animelist WHERE title LIKE ? LIMIT 50",
      [`%${q}%`]
    );
    conn.release();
    res.json(rows);
  } catch (err) {
    console.error('❌ MySQL error:', err);
    res.status(500).json({ error: err.message });
  }
});




process.on('SIGINT', async () => {
  console.log('Shutting down...');
  if (browser) await browser.close();
  process.exit();
});


// let genres = [
//   "historical",
//   "slice-of-life",
//   "mecha",
//   "super-power",
//   "harem",
//   "military",
//   "sports",
//   "suspense",
//   "isekai",
//   "shoujo",
//   "mythology",
//   "psychological",
//   "horror",
//   "music",
//   "gore",
//   "martial-arts",
//   "parody",
//   "detective",
//   "space",
//   "award-winning",
//   "cgdct",
//   "team-sports",
//   "kids",
//   "gag-humor",
//   "iyashikei",
//   "urban-fantasy",
//   "workplace",
//   "vampire",
//   "samurai",
//   "anthropomorphic",
//   "mahou-shoujo",
//   "reincarnation",
//   "josei",
//   "time-travel",
//   "strategy-game",
//   "love-polygon",
//   "otaku-culture",
//   "organized-crime",
//   "idols-female",
//   "gourmet",
//   "video-game",
//   "survival",
//   "racing",
//   "performing-arts",
//   "girls-love",
//   "avant-garde",
//   "reverse-harem",
//   "combat-sports",
//   "childcare",
//   "visual-arts",
//   "love-status-quo",
//   "high-stakes-game",
//   "delinquents",
//   "idols-male",
//   "pets",
//   "medical",
//   "crossdressing",
//   "boys-love",
//   "magical-sex-shift",
//   "showbiz",
//   "erotica",
//   "villainess",
//   "educational"
// ]

// app.get('/fetch-animes', async (req, res) => {
//   if (!browser) {
//     return res.status(503).json({ error: 'Puppeteer browser not initialized yet' });
//   }
//   let animeList = [];

//   try {
//     const puppetPage = await getPage(); // rename to avoid conflict

//     for (const genre of genres) {
//       let pageNumber = 1;
//       let hasNext = true;
//       console.log(`Fetching genre: ${genre}`);

//       while (hasNext) {
//         console.log(`Fetching page: ${pageNumber}`);

//         await puppetPage.goto(`https://anime3rb.com/genre/${genre}?page=${pageNumber}`, {
//           waitUntil: 'networkidle2',
//         });

//         // 👇 Scraping data
//         const list = await puppetPage.evaluate(() => {
//           return Array.from(
//             document.querySelectorAll('div.titles-list > div')
//           ).map(el => {
//             const poster = el.querySelector(
//               'div > a.btn.btn-md.btn-plain.w-full > img'
//             )?.src || null;

//             const title = el.querySelector(
//               'div > a.btn.btn-md.btn-plain.w-full > h2'
//             )?.textContent.trim() || null;

//             const href = el.querySelector(
//               'div > a.btn.btn-md.btn-plain.w-full'
//             )?.href || null;

//             const animeId = href ? href.split('/').pop() : null;

//             return { animeId, poster, title };
//           });
//         });

//         animeList.push(...list);

//         // Bulk insert
//         const values = list
//           .filter(a => a.animeId)
//           .map(a => [a.animeId, a.poster, a.title]);

//         if (values.length) {
//           await connection.query(
//             `INSERT IGNORE INTO animelist (animeId, poster, title) VALUES ?`,
//             [values]
//           );
//         }

//         // 👇 Check if next page exists (inside browser context)
//         hasNext = await puppetPage.evaluate(async () => {
//         // Wait for up to 3 seconds for the button to appear
//         const waitForButton = (selector, timeout = 3000) => {
//           return new Promise(resolve => {
//             const start = Date.now();
//             const interval = setInterval(() => {
//               const btn = document.querySelector(selector);
//               if (btn) {
//                 clearInterval(interval);
//                 resolve(btn);
//               } else if (Date.now() - start > timeout) {
//                 clearInterval(interval);
//                 resolve(null); // Timeout, button not found
//               }
//             }, 5000);
//           });
//         };

//         const nextButton = await waitForButton('[aria-label="التالي"]');
//         return nextButton && !nextButton.disabled;
//         });


//         pageNumber += 1;
//       }
//     }

//     res.json({ count: animeList.length });
// } catch (error) {
//   console.error(error);
//   res.status(500).json({ error: error.message });
// }
// });

app.get('/test-db', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1+1 AS result');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/test-fetch', async (req, res) => {
  try {
    const response = await fetch('https://anime3rb.com');
    res.send(`Status: ${response.status}`);
  } catch (err) {
    res.send(`Error: ${err.message}`);
  }
});


