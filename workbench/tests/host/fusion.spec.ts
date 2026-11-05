import { expect, test } from '@playwright/test';

test('Mineradio host captures current lyric without sharing account secrets', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.waitForFunction(() => typeof (window as any).captureAfterglowMoment === 'function', null, { timeout: 30_000 });
  await page.locator('#splash.ready').waitFor();
  await page.locator('#splash').click();
  await page.waitForFunction(() => !document.body.classList.contains('splash-active'));
  await page.evaluate(() => {
    const host = window as any;
    host.playQueue = [{ id: 'test-song', name: '平行时空', artist: '本地测试', provider: 'netease', duration: 180 }];
    host.currentIdx = 0;
    host.lyricsLines = [
      { t: 8, duration: 6, text: '晚风经过我们熟悉的街口' },
      { t: 14, duration: 6, text: '平行时空也许有另一个以后' },
    ];
    host.stageLyrics.currentIdx = 1;
  });
  await expect(page.locator('#afterglow-capture-dock')).toContainText('平行时空也许有另一个以后', { timeout: 5000 });
  const pickedIndex = await page.evaluate(() => {
    const host = window as any;
    const direction = host.camera.getWorldDirection(new host.THREE.Vector3());
    const mesh = new host.THREE.Mesh(new host.THREE.PlaneGeometry(8, 3), new host.THREE.MeshBasicMaterial());
    mesh.position.copy(host.camera.position).add(direction.multiplyScalar(5));
    mesh.quaternion.copy(host.camera.quaternion);
    mesh.updateMatrixWorld(true);
    const previous = host.stageLyrics.current;
    const previousParticleLyrics = host.fx.particleLyrics;
    const shelfGetMode = host.shelfManager?.getMode;
    host.fx.particleLyrics = true;
    if (host.shelfManager) host.shelfManager.getMode = () => 'off';
    host.stageLyrics.current = { userData: { lyric: { rowLayers: [{ mesh, renderWindowActive: true, renderLineUploaded: true, lineIndex: 0 }] } } };
    const hit = host.stageLyricPickAt(innerWidth / 2, innerHeight / 2);
    host.stageLyrics.current = previous;
    host.fx.particleLyrics = previousParticleLyrics;
    if (host.shelfManager && shelfGetMode) host.shelfManager.getMode = shelfGetMode;
    mesh.geometry.dispose(); mesh.material.dispose();
    return hit?.lineIndex ?? -1;
  });
  expect(pickedIndex).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('mineradio:stage-lyric-pick', { detail: { lineIndex: 0, lineId: 'line-1', text: '晚风经过我们熟悉的街口', time: 8 } })));
  await expect(page.locator('#afterglow-capture-dock')).toHaveClass(/has-stage-pick/);
  await expect(page.locator('#afterglow-capture-dock')).toContainText('晚风经过我们熟悉的街口');
  const dockCenter = await page.locator('#afterglow-capture-dock').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.locator('#afterglow-capture-dock').click();
  const transitionState = await page.evaluate(async () => {
    const host = document.querySelector<HTMLElement>('#afterglow-workbench-host');
    const proxy = document.querySelector<HTMLElement>('.afterglow-book-proxy');
    if (!host || !proxy) return null;
    let animations: Animation[] = [];
    for (let attempt = 0; attempt < 30; attempt += 1) {
      animations = [proxy, ...proxy.querySelectorAll<HTMLElement>('.afterglow-book-leaf')]
        .flatMap((node) => node.getAnimations());
      if (host.classList.contains('is-opening') && animations.length) break;
      await new Promise(requestAnimationFrame);
    }
    animations.forEach((animation) => { animation.currentTime = 320; animation.pause(); });
    const style = getComputedStyle(host);
    return {
      animationCount: animations.length,
      open: host.classList.contains('is-open'),
      opening: host.classList.contains('is-opening'),
      x: Number.parseFloat(style.getPropertyValue('--afterglow-origin-x')),
      y: Number.parseFloat(style.getPropertyValue('--afterglow-origin-y')),
    };
  });
  expect(transitionState).not.toBeNull();
  expect(transitionState?.open).toBe(true);
  expect(transitionState?.opening).toBe(true);
  expect(transitionState?.animationCount).toBe(3);
  expect(Math.abs((transitionState?.x || 0) - dockCenter.x)).toBeLessThanOrEqual(12);
  expect(Math.abs((transitionState?.y || 0) - dockCenter.y)).toBeLessThanOrEqual(12);
  const workbenchHost = page.locator('#afterglow-workbench-host');
  await expect(workbenchHost).toHaveClass(/is-open/);
  await expect(page.locator('.afterglow-book-proxy')).toBeAttached();
  await page.screenshot({ path: 'test-results/fusion-book-transition.png' });
  await page.locator('.afterglow-book-proxy').evaluate((element) => {
    [element, ...element.querySelectorAll('.afterglow-book-leaf')]
      .flatMap((node) => node.getAnimations()).forEach((animation) => animation.play());
  });
  const frame = page.frameLocator('#afterglow-workbench-frame');
  await expect(frame.getByLabel('瞬间笔记')).toBeVisible({ timeout: 15_000 });
  await expect(frame.locator('.source-card')).toContainText('晚风经过我们熟悉的街口');
  await frame.getByLabel('笔记标题').fill('另一个以后');
  await frame.getByLabel('瞬间笔记').fill('先留下这一刻，之后再继续展开。');
  await expect(frame.locator('.save-indicator')).toContainText('已保存');
  await page.evaluate(() => {
    const host = window as any;
    host.playQueue.push({ id: 'other-song', name: '另一首歌', artist: '本地测试', provider: 'netease', duration: 200 });
    host.currentIdx = 1;
    host.playQueueAt = async (index: number, options: unknown) => { host.currentIdx = index; host.__afterglowRestoreOptions = options; return true; };
  });
  await frame.getByRole('button', { name: '从前 3 秒回听' }).click();
  await expect.poll(() => page.evaluate(() => ({ index: (window as any).currentIdx, options: (window as any).__afterglowRestoreOptions }))).toEqual({ index: 0, options: { manual: true, resumeAt: 5, preserveHomeState: true, skipShuffleOrder: true } });
  await frame.getByRole('button', { name: '瞬间' }).click();
  await expect(frame.locator('.library-grid')).toContainText('另一个以后');
  await frame.getByRole('button', { name: '分析' }).click();
  await expect(frame.locator('.analysis-scaffold')).toContainText('EPN 服务暂时不可用');
  await page.screenshot({ path: 'test-results/fusion-workbench.png', fullPage: true, animations: 'disabled' });
  const messages = await page.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>('#afterglow-workbench-frame');
    return { parentOrigin: location.origin, childOrigin: frame?.contentWindow?.location.origin, src: frame?.getAttribute('src') };
  });
  expect(messages.childOrigin).toBe(messages.parentOrigin);
  expect(messages.src).not.toContain('token');
  await frame.getByLabel('关闭工作台').click();
  await expect(page.locator('#afterglow-workbench-host')).not.toHaveClass(/is-open/);
  expect(errors).toEqual([]);
});

test('Afterglow previews imports and exposes rotating backup recovery', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof (window as any).captureAfterglowMoment === 'function', null, { timeout: 30_000 });
  await page.locator('#splash.ready').waitFor();
  await page.locator('#splash').click();
  await page.waitForFunction(() => !document.body.classList.contains('splash-active'));
  await page.evaluate(() => {
    const host = window as any;
    const now = new Date().toISOString();
    const savedMoment = { id: 'saved-1', trackId: 'song:archive', trackTitle: '存档之歌', artist: '本机测试', lineId: 'line-1', quote: '留下这一句', at: 12, capturedAt: Date.now(), title: '旧笔记', body: '已经安全保存', createdAt: now, updatedAt: now };
    host.desktopWindow = {
      afterglowListMoments: async () => ({ ok: true, moments: [savedMoment], recoveredFromBackup: true, recovery: { backupId: 'backup-1', backupUpdatedAt: now, recoveredAt: now, reason: 'PRIMARY_CORRUPT' } }),
      afterglowSaveMoment: async (moment: unknown) => ({ ok: true, moment }),
      afterglowDeleteMoment: async () => ({ ok: true, deleted: true }),
      afterglowListTrackSnapshots: async () => ({ ok: true, trackSnapshots: [] }),
      afterglowSaveTrackSnapshot: async (track: unknown) => ({ ok: true, trackSnapshot: track }),
      afterglowExportNotebook: async () => ({ ok: true, canceled: false }),
      afterglowPrepareImport: async () => ({ ok: true, token: 'preview-token', baseUpdatedAt: now, preview: { moments: { added: 2, incomingNewer: 1, localNewer: 1, diverged: 1, unchanged: 0 }, tracks: { added: 1, conflict: 1, unchanged: 0 }, orphanedMoments: 1, incoming: { moments: 5, tracks: 2 }, local: { moments: 1, tracks: 0 } } }),
      afterglowCommitImport: async () => ({ ok: true, moments: 5, tracks: 2 }),
      afterglowListBackups: async () => ({ ok: true, currentUpdatedAt: now, backups: [{ id: 'notebook-test.json', createdAt: now, updatedAt: now, moments: 1, tracks: 1, bytes: 2048 }] }),
      afterglowRestoreBackup: async () => ({ ok: true, moments: 1, tracks: 1 }),
      afterglowAcknowledgeRecovery: async () => ({ ok: true }),
    };
    host.playQueue = [{ id: 'archive', name: '存档之歌', artist: '本机测试', provider: 'netease', duration: 180 }];
    host.currentIdx = 0;
    host.lyricsLines = [{ t: 12, duration: 6, text: '留下这一句' }];
    host.stageLyrics.currentIdx = 0;
    host.openAfterglowWorkbench();
  });
  const frame = page.frameLocator('#afterglow-workbench-frame');
  await expect(frame.getByText('主存档曾无法读取，已自动恢复备份')).toBeVisible({ timeout: 15_000 });
  await frame.getByRole('button', { name: '瞬间' }).click();
  await frame.getByRole('button', { name: '存档', exact: true }).click();
  await expect(frame.getByRole('dialog', { name: '完整存档与备份' })).toBeVisible();
  await expect(frame.getByText('1 条瞬间 · 1 首曲目')).toBeVisible();
  await frame.getByRole('button', { name: /导入 JSON/ }).click();
  await expect(frame.getByText('导入前预览')).toBeVisible();
  await expect(frame.getByText('2', { exact: true }).first()).toBeVisible();
  await expect(frame.getByText('1 条记录缺少曲目快照')).toBeVisible();
  await page.screenshot({ path: 'test-results/fusion-archive-preview.png', fullPage: true, animations: 'disabled' });
});
