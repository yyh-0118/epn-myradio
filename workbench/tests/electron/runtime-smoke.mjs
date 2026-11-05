import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const userData = path.join(root, 'test-results', `electron-afterglow-user-data-${process.pid}-${Date.now()}`);
fs.mkdirSync(userData, { recursive: true });

function openPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForCdp(port, timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Electron CDP timeout');
}

async function launch() {
  const port = await openPort();
  const child = spawn(electron, [`--remote-debugging-port=${port}`, '.'], {
    cwd: root,
    env: { ...process.env, MINERADIO_STARTUP_QA_HIDDEN: '1', MINERADIO_STARTUP_QA_USER_DATA: userData, USE_REAL_LLM: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  await waitForCdp(port);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  let page;
  for (let attempt = 0; attempt < 300; attempt++) {
    page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => /^http:\/\/127\.0\.0\.1:\d+\//.test(candidate.url()));
    if (page) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const urls = browser.contexts().flatMap((context) => context.pages()).map((item) => item.url());
  if (!page) throw new Error(`Mineradio page unavailable (${urls.join(', ')}). ${stderr}`);
  await page.waitForFunction(() => typeof window.captureAfterglowMoment === 'function', null, { timeout: 30000 });
  return { child, browser, page, stderr: () => stderr };
}

async function close(runtime) {
  const exited = new Promise((resolve) => runtime.child.once('exit', resolve));
  try { await runtime.page.evaluate(() => window.desktopWindow?.close?.('exit')); } catch {}
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10000))]);
  if (runtime.child.exitCode == null) {
    runtime.child.kill('SIGTERM');
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
  }
  await runtime.browser.close().catch(() => {});
}

let first;
let second;
try {
  first = await launch();
  await first.page.evaluate(() => {
    window.playQueue = [{ id: 'electron-test', name: '平行时空', artist: '本机测试', provider: 'netease', duration: 180 }];
    window.currentIdx = 0;
    window.lyricsLines = [
      { t: 8, duration: 6, text: '晚风经过我们熟悉的街口' },
      { t: 14, duration: 6, text: '平行时空也许有另一个以后' },
      { t: 20, duration: 6, text: '回声把没说完的话轻轻带走' },
      { t: 26, duration: 6, text: '落日仍留在同一双眼眸' },
    ];
    window.stageLyrics.currentIdx = 1;
  });
  await first.page.locator('#afterglow-capture-dock').click();
  const frame = first.page.frameLocator('#afterglow-workbench-frame');
  await frame.getByLabel('瞬间笔记').fill('这条记录应该跨重启留下来。');
  await frame.getByLabel('笔记标题').fill('稳定存储测试');
  await frame.locator('.save-indicator').getByText('已保存到本机工作台').waitFor({ timeout: 10000 });
  await frame.getByRole('button', { name: '分析' }).click();
  await frame.getByRole('button', { name: '分析这首歌', exact: true }).click();
  await frame.locator('.source-badge').getByText(/规则分析/).waitFor({ timeout: 30000 });
  await first.page.screenshot({ path: path.join(root, 'test-results', 'electron-fusion-analysis.png'), fullPage: true, animations: 'disabled' });
  await frame.getByRole('button', { name: '写下' }).click();
  const finalBody = '这条记录应该跨重启留下来，最后输入的字符也不能丢。';
  await frame.getByLabel('瞬间笔记').fill(finalBody);
  await close(first); first = null;
  const notebook = path.join(userData, 'afterglow', 'notebook.json');
  if (!fs.existsSync(notebook)) throw new Error('Stable notebook was not created.');
  const stored = JSON.parse(fs.readFileSync(notebook, 'utf8'));
  const storedMoment = stored.moments.find((moment) => moment.title === '稳定存储测试');
  if (!storedMoment) throw new Error('Stable note missing from notebook.');
  if (storedMoment.body !== finalBody) throw new Error('Close flush lost the final debounced note text.');
  const storedTrack = stored.trackSnapshots.find((track) => track.playbackRef?.id === 'electron-test');
  if (!storedTrack) throw new Error('Safe playback reference missing from notebook.');
  if (JSON.stringify(stored).includes('cookie') || JSON.stringify(stored).includes('audioUrl')) throw new Error('Sensitive fields leaked into notebook.');
  const backupDirectory = path.join(userData, 'afterglow', 'backups');
  const backups = fs.existsSync(backupDirectory) ? fs.readdirSync(backupDirectory).filter((name) => name.endsWith('.json')) : [];
  if (!backups.length || backups.length > 5) throw new Error(`Unexpected rotating backup count: ${backups.length}`);

  second = await launch();
  await second.page.evaluate(() => {
    localStorage.removeItem('mineradio-last-playback-v1');
    window.playQueue = [{ id: 'different-track', name: '另一首歌', artist: '本机测试', provider: 'netease', duration: 200 }];
    window.currentIdx = 0;
    window.playQueueAt = async (index, options) => { window.currentIdx = index; window.__afterglowRestoreOptions = options; return true; };
    window.openAfterglowWorkbench();
  });
  const reopened = second.page.frameLocator('#afterglow-workbench-frame');
  await reopened.getByRole('button', { name: '瞬间' }).click();
  await reopened.locator('.library-grid').getByText('稳定存储测试').waitFor({ timeout: 15000 });
  await reopened.locator('.moment-card, .open-card').filter({ hasText: '稳定存储测试' }).click();
  await reopened.getByRole('button', { name: '从前 3 秒回听' }).click();
  const restored = await second.page.waitForFunction(() => window.__afterglowRestoreOptions && window.currentIdx === 1).then((handle) => handle.jsonValue());
  if (!restored) throw new Error('Cross-restart track restore did not complete.');
  const restoreOptions = await second.page.evaluate(() => window.__afterglowRestoreOptions);
  if (restoreOptions.resumeAt !== 11) throw new Error(`Unexpected resumeAt: ${restoreOptions.resumeAt}`);
  console.log(JSON.stringify({ ok: true, persistentNote: true, closeFlush: true, rotatingBackups: true, epnRules: true, restartRecovery: true, crossTrackReplay: true }));
} finally {
  if (first) await close(first);
  if (second) await close(second);
  try { fs.rmSync(userData, { recursive: true, force: true }); }
  catch (error) { console.warn(`Electron test data cleanup deferred: ${error instanceof Error ? error.message : error}`); }
}
