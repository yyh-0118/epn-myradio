'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appRoot = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(appRoot, 'public', 'index.html'), 'utf8');
const dashboardScript = fs.readFileSync(
  path.join(appRoot, 'public', 'js', 'modules', '05-playback', '03a-home-dashboard.js'),
  'utf8',
);
const indexCss = fs.readFileSync(path.join(appRoot, 'public', 'css', 'index.css'), 'utf8');

function namedFunctionSource(source, name) {
  const declaration = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  if (!declaration) return '';
  const bodyStart = source.indexOf('{', declaration.index + declaration[0].length);
  if (bodyStart < 0) return '';
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(declaration.index, index + 1);
    }
  }
  return '';
}

test('home hero picker accepts videos, animated images and still photos and rejects the rest', () => {
  assert.match(
    indexHtml,
    /id="home-dashboard-video-input"[^>]*type="file"[^>]*accept="[^"]*\.mp4[^"]*\.gif[^"]*\.jpg[^"]*"/,
  );
  const exts = dashboardScript.match(/var HOME_BG_VIDEO_EXT = [^;]+;\s*var HOME_BG_IMAGE_EXT = [^;]+;/)[0];
  const classifySource = namedFunctionSource(dashboardScript, 'homeDashboardClassifyBackground');
  assert.ok(classifySource, 'expected homeDashboardClassifyBackground()');
  const classify = vm.runInNewContext(`${exts}(${classifySource})`);
  assert.equal(classify({ name: 'a.mp4', type: 'video/mp4' }).kind, 'video');
  assert.equal(classify({ name: 'live.MOV', type: '' }).kind, 'video');
  assert.equal(classify({ name: 'a.gif', type: 'image/gif' }).kind, 'image');
  assert.equal(classify({ name: 'a.JPG', type: '' }).kind, 'image');
  assert.match(classify({ name: 'a.heic', type: 'image/heic' }).error, /HEIC/);
  assert.ok(classify({ name: 'a.pdf', type: 'application/pdf' }).error);
});

test('home hero video has isolated persistence and never enters global wallpaper paths', () => {
  assert.match(dashboardScript, /HOME_DASHBOARD_VIDEO_DB_NAME\s*=\s*['"]mineradio-home-dashboard-video-v1['"]/);
  assert.match(dashboardScript, /HOME_DASHBOARD_VIDEO_BLOB_ID\s*=\s*['"]home-hero-video['"]/);
  assert.match(dashboardScript, /HOME_DASHBOARD_VIDEO_META_KEY\s*=\s*['"]mineradio-home-dashboard-video-meta-v1['"]/);
  const videoFunctions = [
    'homeDashboardOpenVideoDb',
    'homeDashboardPutVideoBlob',
    'homeDashboardGetVideoBlob',
    'homeDashboardAttachVideo',
    'handleHomeDashboardVideoFile',
  ].map((name) => namedFunctionSource(dashboardScript, name)).join('\n');
  for (const forbidden of ['openCustomBackgroundDb', 'CUSTOM_BG_', 'wallpaper-engine', '.pak', 'DWM']) {
    assert.equal(videoFunctions.includes(forbidden), false, `home MP4 path must not use ${forbidden}`);
  }
});

test('home hero video is low-impact and releases its object URL off home', () => {
  const attach = namedFunctionSource(dashboardScript, 'homeDashboardAttachVideo');
  const release = namedFunctionSource(dashboardScript, 'homeDashboardReleaseVideoSource');
  const shouldPlay = namedFunctionSource(dashboardScript, 'homeDashboardVideoShouldPlay');
  assert.match(attach, /video\.muted\s*=\s*true/);
  assert.match(attach, /video\.loop\s*=\s*true/);
  assert.match(attach, /video\.playsInline\s*=\s*true/);
  assert.match(attach, /video\.preload\s*=\s*['"]metadata['"]/);
  assert.match(release, /video\.pause\s*\(/);
  assert.match(release, /video\.removeAttribute\s*\(\s*['"]src['"]\s*\)/);
  assert.match(release, /video\.load\s*\(/);
  assert.match(release, /URL\.revokeObjectURL/);
  assert.match(shouldPlay, /!document\.hidden/);
  assert.match(shouldPlay, /emptyHomeActive/);
  assert.match(shouldPlay, /empty-home-active/);
  assert.match(dashboardScript, /document\.addEventListener\(\s*['"]visibilitychange['"]/);
  assert.match(dashboardScript, /new\s+MutationObserver/);
  assert.match(indexCss, /#empty-home\s+\.home-dashboard-video\s*\{[\s\S]*?object-fit:\s*cover;[\s\S]*?pointer-events:\s*none;/);
});

test('platform recommendation entry uses real feeds and does not synthesize radio searches', () => {
  assert.match(indexHtml, /id="home-platform-recommend-mask"/);
  for (const source of ['netease', 'qishui', 'qq', 'kugou']) {
    assert.match(indexHtml, new RegExp(`data-home-recommend-source="${source}"`));
  }
  const openCharts = namedFunctionSource(dashboardScript, 'openHomeDashboardCharts');
  assert.match(openCharts, /openHomePlatformRecommendations\s*\(\s*['"]netease['"]\s*\)/);
  assert.doesNotMatch(openCharts, /runHomeSearch|今日热歌/);
  const neteaseLoader = namedFunctionSource(dashboardScript, 'loadHomePlatformNeteaseRecommendations');
  assert.match(neteaseLoader, /loadHomeDiscover\s*\(/);
  assert.match(neteaseLoader, /\/api\/podcast\/hot/);
  const feedConfig = namedFunctionSource(dashboardScript, 'homePlatformRecommendationFeedConfig');
  assert.match(feedConfig, /\/api\/qishui\/feed/);
  assert.match(feedConfig, /\/api\/kugou\/recommendations/);
  assert.doesNotMatch(feedConfig, /\/api\/qq\/|search/);
  assert.match(namedFunctionSource(dashboardScript, 'loadHomePlatformFeedRecommendations'), /apiJson\s*\(\s*config\.endpoint/);
  assert.match(namedFunctionSource(dashboardScript, 'loadHomePlatformFeedRecommendations'), /feedState\.fallback/);
  assert.match(namedFunctionSource(dashboardScript, 'loadHomePlatformFeedRecommendations'), /feedState\.mode/);
  assert.match(namedFunctionSource(dashboardScript, 'renderHomePlatformRecommendations'), /liked-affinity/);
  assert.match(namedFunctionSource(dashboardScript, 'renderHomePlatformRecommendations'), /personal-top/);
  assert.match(dashboardScript, /当前版本没有可验证的平台推荐接口，未使用关键词搜索替代/);
  assert.doesNotMatch(indexHtml, /home-ranking-entry|home-radio-entry/);
});
