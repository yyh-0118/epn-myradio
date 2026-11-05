import { expect, test } from '@playwright/test';

const quote = '我们在不同的站台望向远方';

async function enterNotebook(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: `选择歌词：${quote}`, exact: true }).click();
  await page.getByRole('button', { name: '记录此刻', exact: true }).click();
  await expect(page.getByRole('heading', { name: /刚才的那一刻，\s*值得多停留一会儿。/ })).toBeVisible();
  await page.getByRole('button', { name: /打开我的工作台/ }).click();
  await expect(page.getByRole('textbox', { name: '我的瞬间笔记' })).toBeFocused();
}

test('listen → capture → note → analysis → archive → reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/listening-desktop.png', fullPage: true, animations: 'disabled' });
  await enterNotebook(page);
  expect(await page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(false);
  await expect(page.locator('.note-source')).toContainText('00:16');
  await page.getByRole('textbox', { name: '笔记标题' }).fill('留给另一个故事');
  await page.getByRole('textbox', { name: '我的瞬间笔记' }).fill('那一瞬间想到了一段还没写完的故事。先记下来，以后接着写。');
  await expect(page.getByRole('status').filter({ hasText: '已保存到此浏览器' })).toBeVisible();
  const analysisRequest = page.waitForRequest((request) => request.url().endsWith('/api/analysis/run'));
  await page.getByRole('button', { name: '分析这首歌', exact: true }).click();
  const request = await analysisRequest;
  expect(request.postData()).not.toContain('先记下来');
  await expect(page.locator('.source-badge')).toContainText(/规则/);
  await expect(page.locator('.annotated-lyrics mark').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/workbench-desktop.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: '情感参考', exact: true }).click();
  await expect(page.locator('.emotion-content')).toContainText('不是实际音频能量');
  await page.getByRole('button', { name: '瞬间素材库', exact: true }).first().click();
  await page.getByRole('textbox', { name: '搜索瞬间' }).fill('另一个故事');
  await expect(page.locator('.moment-card')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/library-desktop.png', fullPage: true, animations: 'disabled' });
  await page.reload();
  await page.getByRole('button', { name: '瞬间素材库', exact: true }).first().click();
  await page.locator('.moment-open').filter({ hasText: '留给另一个故事' }).click();
  await expect(page.getByRole('textbox', { name: '我的瞬间笔记' })).toHaveValue('那一瞬间想到了一段还没写完的故事。先记下来，以后接着写。');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出笔记', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('留给另一个故事.md');
  await page.getByRole('button', { name: /从这句之前 3 秒回听/ }).click();
  await expect.poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThanOrEqual(13);
  await page.getByRole('button', { name: '瞬间素材库', exact: true }).first().click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '删除记录：留给另一个故事', exact: true }).click();
  await expect(page.locator('.moment-card')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('local audio and timed lyrics persist; changing track does not change a note source', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
  const audio = Buffer.alloc(44 + 8000 * 12 * 2);
  audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
  audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
  audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
  for (let i = 0; i < 8000 * 12; i++) audio.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 220 / 8000) * 800), 44 + i * 2);
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByLabel('选择音频文件', { exact: true }).setInputFiles({ name: '本地回声.wav', mimeType: 'audio/wav', buffer: Buffer.from(audio) });
  await page.getByLabel('歌词 可选', { exact: false }).fill('[00:02.00]本地的晚风\n[00:05.00]留下回声');
  await page.getByRole('button', { name: '进入聆听室', exact: true }).click();
  await expect(page.getByRole('heading', { name: '本地回声', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '选择歌词：留下回声', exact: true }).click();
  await page.getByRole('button', { name: '记录此刻', exact: true }).click();
  await page.getByRole('button', { name: /打开我的工作台/ }).click();
  await page.getByRole('textbox', { name: '我的瞬间笔记' }).fill('本地音频关联测试');
  await expect(page.locator('.save-state')).toContainText('已保存');
  await page.getByLabel('选择歌曲', { exact: true }).selectOption('afterglow-demo-v1');
  await expect(page.locator('.note-source')).toContainText('本地回声');
  await page.reload();
  await page.getByRole('button', { name: '瞬间素材库', exact: true }).first().click();
  await page.getByRole('button', { name: /本地音频关联测试/ }).click();
  await page.getByRole('button', { name: /从这句之前 3 秒回听/ }).click();
  await expect(page.locator('.now-playing')).toContainText('本地回声');
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible();
});

test('analysis failure keeps note usable; mobile has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.screenshot({ path: 'test-results/listening-mobile.png', fullPage: true, animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await enterNotebook(page);
  await page.route('**/api/analysis/run', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '分析暂时不可用，稍后重试。' }) }));
  await page.getByRole('textbox', { name: '我的瞬间笔记' }).fill('没有分析也可以写。');
  await page.getByRole('button', { name: '分析这首歌', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '分析暂时不可用' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '我的瞬间笔记' })).toHaveValue('没有分析也可以写。');
  await expect(page.locator('.save-state')).toContainText('已保存');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/workbench-mobile.png', fullPage: true, animations: 'disabled' });
});
