const { _electron } = require('playwright');
const SHOTS = process.env.TEMP + '/paddock-shot';
const REPO = process.env.TEMP + '/paddock-demo';

(async () => {
  const app = await _electron.launch({
    args: ['.'], cwd: '~/WorkHorse/desk',
    env: { ...process.env, PADDOCK_E2E_ADD_REPO: REPO },
  });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(2500);

  const card = win.getByRole('button', { name: 'Open paddock-demo' });
  await card.getByRole('button', { name: 'Onboard' }).click();
  console.log('clicked Onboard at', new Date().toISOString());

  const samples = [10000, 40000, 60000, 60000, 90000, 90000, 90000];
  for (let i = 0; i < samples.length; i++) {
    await win.waitForTimeout(samples[i]);
    await win.screenshot({ path: `${SHOTS}/run-${i}.png` });
    const s = await win.evaluate(() => {
      const q = (sel) => document.querySelectorAll(sel).length;
      return {
        text: document.body.innerText.replace(/\n+/g, ' | ').slice(0, 300),
        canvases: q('canvas'),
        sats: q('[class*="satellite"]'),
        lit: q('[class*="lit"]'),
        logLines: q('[class*="log"] li, [class*="log-line"], [class*="rail"] li'),
      };
    });
    console.log(`\n[t+${i}] canvases=${s.canvases} satellites=${s.sats} lit=${s.lit} logLines=${s.logLines}`);
    console.log('   ', s.text);
  }
  await app.close();
  console.log('\nDONE');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
