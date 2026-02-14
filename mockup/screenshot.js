const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto('file:///root/workspace/spotify-party-interface/mockup/index.html', { waitUntil: 'networkidle0' });

  // Wait for page to fully load
  await new Promise(r => setTimeout(r, 1000));

  // Screenshot 1: Now Playing (top of page) - scroll just a bit to show FAB
  await page.evaluate(() => {
    const content = document.querySelector('.content');
    if (content) content.scrollTo(0, 100);
  });
  await new Promise(r => setTimeout(r, 300));
  await page.screenshot({ path: 'now-playing.png', fullPage: false });
  console.log('Now Playing screenshot saved!');

  // Screenshot 2: Scroll down to show queue
  await page.evaluate(() => {
    const content = document.querySelector('.content');
    if (content) content.scrollTo(0, 400);
  });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: 'queue.png', fullPage: false });
  console.log('Queue screenshot saved!');

  // Screenshot 3: Open search overlay
  await page.evaluate(() => {
    const searchBtn = document.getElementById('searchBtn');
    if (searchBtn) searchBtn.click();
  });
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: 'search.png', fullPage: false });
  console.log('Search screenshot saved!');

  await browser.close();
  console.log('All screenshots saved!');
})();
