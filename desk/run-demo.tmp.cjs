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
  await card.getByLabel('Client context').fill('internal tooling, single operator, no compliance, local only');
  await win.screenshot({ path: `${SHOTS}/onboard-prompt.png` });
  await card.getByRole('button', { name: 'Go' }).click();
  console.log('started onboarding at', new Date().toISOString());

  const waits = [12000, 35000, 45000, 60000, 60000, 75000, 75000, 75000, 75000];
  for (let i = 0; i < waits.length; i++) {
    await win.waitForTimeout(waits[i]);
    await win.screenshot({ path: `${SHOTS}/run-${i}.png` });
    const s = await win.evaluate(() => {
      const q = (sel) => document.querySelectorAll(sel).length;
      const logs = [...document.querySelectorAll('[class*="log"]')]
        .map((e) => e.textContent || '').join(' ').slice(-260);
      return {
        sats: q('[class*="satellite"]'),
        lit: q('[class*="is-lit"], [class*="lit"]'),
        action: (document.querySelector('.run-primary button, [class*="primary"] button') || {}).textContent || '?',
        logs,
      };
    });
    console.log(`\n[t+${i}] satellites=${s.sats} lit=${s.lit} action="${s.action}"`);
    console.log('   log tail:', s.logs.replace(/\s+/g, ' '));
  }
  await app.close();
  console.log('\nDONE');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
