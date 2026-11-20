/* 首页自定义：聆听统计 + AI 偏好分析、播放顺序面板。依赖 02-listen-stats.js / 14-player-controls.js 的全局状态。 */
var HOME_TASTE_CACHE_KEY = 'mineradio-home-taste-v1';
var homeCustomTasteBusy = false;
var homeCustomTasteLive = '';
var homeCustomTasteAbort = null;
var homeCustomOrderOpen = false;
var HOME_NOTES_CONSENT_KEY = 'afterglow-ai-notes-consent-v1';
var homeCustomMoments = null;
var homeCustomMomentsLoading = false;

function homeCustomEsc(value) {
  return typeof escHtml === 'function' ? escHtml(String(value == null ? '' : value)) : String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

function homeCustomDuration(ms) {
  var minutes = Math.round((Number(ms) || 0) / 60000);
  if (minutes < 60) return minutes + ' 分钟';
  var hours = Math.floor(minutes / 60);
  var rest = minutes % 60;
  return hours + ' 小时' + (rest ? ' ' + rest + ' 分' : '');
}

function homeCustomMask(id, title, bodyId) {
  var mask = document.getElementById(id);
  if (mask) return mask;
  mask = document.createElement('div');
  mask.id = id;
  mask.className = 'modal-mask home-custom-mask';
  mask.setAttribute('role', 'dialog');
  mask.setAttribute('aria-modal', 'true');
  mask.setAttribute('aria-hidden', 'true');
  mask.innerHTML = '<div class="modal home-custom-modal"><div class="home-custom-head"><h2>' + homeCustomEsc(title) + '</h2>' +
    '<button type="button" class="home-custom-close" aria-label="关闭">×</button></div><div class="home-custom-body" id="' + bodyId + '"></div></div>';
  document.body.appendChild(mask);
  mask.addEventListener('click', function (event) { if (event.target === mask) homeCustomClose(id); });
  mask.querySelector('.home-custom-close').addEventListener('click', function () { homeCustomClose(id); });
  return mask;
}

function homeCustomOpen(mask) {
  mask.classList.add('show');
  mask.setAttribute('aria-hidden', 'false');
}

function homeCustomClose(id) {
  var mask = document.getElementById(id);
  if (!mask) return;
  mask.classList.remove('show');
  mask.setAttribute('aria-hidden', 'true');
  if (id === 'home-order-mask') homeCustomOrderOpen = false;
}

document.addEventListener('keydown', function (event) {
  if (event.key !== 'Escape') return;
  ['home-stats-mask', 'home-order-mask'].forEach(function (id) {
    var mask = document.getElementById(id);
    if (mask && mask.classList.contains('show')) homeCustomClose(id);
  });
});

/* ---------- 聆听统计 ---------- */
function homeCustomStats() {
  var state = typeof listenStatsState === 'object' && listenStatsState ? listenStatsState : { history: [], songs: {}, artists: {} };
  var rollup = typeof loadListenRollupV2 === 'function' ? loadListenRollupV2() : { totalListenMs: 0, sessions: 0, daily: {} };
  var days = [];
  for (var offset = 13; offset >= 0; offset--) {
    var date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    var key = typeof listenDayKey === 'function' ? listenDayKey(date.getTime()) : date.toISOString().slice(0, 10);
    var day = rollup.daily && rollup.daily[key] || {};
    days.push({ key: key, label: (date.getMonth() + 1) + '/' + date.getDate(), ms: Math.max(0, Number(day.listenMs) || 0) });
  }
  var songs = Object.keys(state.songs || {}).map(function (key) { return state.songs[key]; }).filter(Boolean)
    .sort(function (a, b) { return (b.listenMs || 0) - (a.listenMs || 0); });
  var artists = Object.keys(state.artists || {}).map(function (key) { return state.artists[key]; }).filter(Boolean)
    .sort(function (a, b) { return (b.listenMs || 0) - (a.listenMs || 0); });
  var hours = new Array(24).fill(0);
  (state.history || []).forEach(function (record) {
    if (record && record.playedAt) hours[new Date(record.playedAt).getHours()] += Math.max(0, Number(record.listenMs) || 0);
  });
  /* history 里每首歌只留最近一次，会低估；rollup.hours 记录了之后的全部聆听。两者都是下限，逐小时取较大值。 */
  (rollup.hours || []).forEach(function (ms, hour) { if (hour < 24 && ms > hours[hour]) hours[hour] = ms; });
  return { rollup: rollup, days: days, songs: songs, artists: artists, hours: hours, history: state.history || [], nightSince: state.nightSince || 0 };
}

function homeCustomBars(items, maxValue, labelFn, valueFn) {
  return items.map(function (item) {
    var value = valueFn(item);
    var width = maxValue > 0 ? Math.max(value > 0 ? 3 : 0, Math.round(value / maxValue * 100)) : 0;
    return '<div class="hs-bar-row"><span class="hs-bar-name">' + homeCustomEsc(labelFn(item)) + '</span><span class="hs-bar"><i style="width:' + width + '%"></i></span><span class="hs-bar-val">' + homeCustomEsc(homeCustomDuration(value)) + '</span></div>';
  }).join('');
}

function homeCustomRenderStats() {
  var body = document.getElementById('home-stats-body');
  if (!body) return;
  var stats = homeCustomStats();
  var maxDay = Math.max.apply(null, stats.days.map(function (d) { return d.ms; }).concat([1]));
  var maxHour = Math.max.apply(null, stats.hours.concat([1]));
  var topSongs = stats.songs.slice(0, 5);
  var topArtists = stats.artists.slice(0, 5);
  var peakHour = stats.hours.indexOf(Math.max.apply(null, stats.hours));
  var empty = !stats.rollup.sessions && !stats.songs.length;
  body.innerHTML = '<div class="hs-summary">' +
    '<div><strong>' + homeCustomEsc(homeCustomDuration(stats.rollup.totalListenMs)) + '</strong><span>累计聆听</span></div>' +
    '<div><strong>' + (stats.rollup.sessions || 0) + '</strong><span>聆听次数</span></div>' +
    '<div><strong>' + stats.songs.length + '</strong><span>听过的歌</span></div>' +
    '<div><strong>' + (empty || !Math.max.apply(null, stats.hours) ? '—' : peakHour + ':00') + '</strong><span>最常听的时段</span></div></div>' +
    (empty ? '<p class="hs-empty">还没有聆听记录。听几首歌之后，这里会生成统计。</p>' : '') +
    '<section class="hs-block"><h3>最近 14 天</h3><div class="hs-days">' + stats.days.map(function (d) {
      return '<div class="hs-day" title="' + homeCustomEsc(d.label + ' · ' + homeCustomDuration(d.ms)) + '"><i style="height:' + Math.max(d.ms > 0 ? 4 : 1, Math.round(d.ms / maxDay * 100)) + '%"></i><span>' + homeCustomEsc(d.label) + '</span></div>';
    }).join('') + '</div></section>' +
    '<section class="hs-block"><h3>一天中的时段</h3><div class="hs-hours">' + stats.hours.map(function (ms, hour) {
      return '<div class="hs-hour" title="' + hour + ':00 · ' + homeCustomEsc(homeCustomDuration(ms)) + '"><i style="height:' + Math.max(ms > 0 ? 4 : 1, Math.round(ms / maxHour * 100)) + '%"></i><span>' + (hour % 6 === 0 ? hour : '') + '</span></div>';
    }).join('') + '</div></section>' +
    '<div class="hs-two"><section class="hs-block"><h3>常听歌曲</h3>' + (topSongs.length ? homeCustomBars(topSongs, topSongs[0].listenMs || 1, function (s) { return s.name; }, function (s) { return s.listenMs || 0; }) : '<p class="hs-empty">暂无</p>') + '</section>' +
    '<section class="hs-block"><h3>常听歌手</h3>' + (topArtists.length ? homeCustomBars(topArtists, topArtists[0].listenMs || 1, function (a) { return a.name; }, function (a) { return a.listenMs || 0; }) : '<p class="hs-empty">暂无</p>') + '</section></div>' +
    '<section class="hs-block" id="hs-insights"></section>' +
    '<section class="hs-block hs-taste" id="hs-taste"><h3>AI 偏好分析</h3><div id="hs-taste-body"></div></section>';
  homeCustomRenderInsights();
  homeCustomRenderTaste();
  homeCustomLoadMoments().then(homeCustomRenderInsights);
}

function homeCustomNotesConsent() {
  try { return localStorage.getItem(HOME_NOTES_CONSENT_KEY) === 'granted'; } catch (_error) { return false; }
}

/* 从余响笔记库读取笔记（仅在 Electron 主窗口可用）。只用来在本机数条数，不会发送。 */
async function homeCustomLoadMoments() {
  homeCustomMomentsLoading = true;
  try {
    var api = window.desktopWindow;
    if (!api || typeof api.afterglowListMoments !== 'function') return null;
    var result = await api.afterglowListMoments();
    homeCustomMoments = result && result.ok && Array.isArray(result.moments) ? result.moments : null;
  } catch (_error) { homeCustomMoments = null; }
  homeCustomMomentsLoading = false;
  return homeCustomMoments;
}

function homeCustomInsights(stats) {
  var songs = stats.songs || [];
  var write = typeof listenWriteVsListen === 'function' && homeCustomMoments
    ? listenWriteVsListen(songs, listenNoteIndex(homeCustomMoments), 5) : null;
  var night = typeof listenNightSongs === 'function' ? listenNightSongs(songs, 5) : [];
  return { write: write, night: night };
}

function homeCustomSongLine(item, detail) {
  return '<div class="hs-point"><b>' + homeCustomEsc(item.name) + (item.artist ? ' · ' + homeCustomEsc(item.artist) : '') + '</b><span>' + homeCustomEsc(detail) + '</span></div>';
}

function homeCustomInsightsHtml(stats) {
  var info = homeCustomInsights(stats);
  var html = '<h3>听与写</h3>';
  if (!info.write) {
    html += '<p class="hs-empty">' + (homeCustomMomentsLoading ? '正在读取笔记…' : '在桌面版里写下笔记后，这里会对照你的聆听记录。') + '</p>';
  } else if (!info.write.totalNotes) {
    html += '<p class="hs-empty">还没有写过笔记。听歌时点一下歌词，就能留下第一条。</p>';
  } else {
    html += '<p class="hs-sub">写得最多的歌（共 ' + info.write.totalNotes + ' 条笔记）</p>';
    html += info.write.mostWritten.map(function (item) {
      return homeCustomSongLine(item, item.notes + ' 条笔记' + (item.plays ? ' · 听了 ' + item.plays + ' 次，' + homeCustomDuration(item.minutes * 60000) : ''));
    }).join('');
    if (info.write.listenedNotWritten.length) {
      html += '<p class="hs-sub">常听但一条没写过</p>';
      html += info.write.listenedNotWritten.map(function (item) { return homeCustomSongLine(item, '听了 ' + item.plays + ' 次，' + homeCustomDuration(item.minutes * 60000)); }).join('');
    }
  }
  html += '<h3 class="hs-gap">深夜反复听的歌</h3>';
  var since = stats.nightSince ? new Date(stats.nightSince).toLocaleDateString('zh-CN') : '';
  if (info.night.length) {
    html += '<p class="hs-sub">23 点到凌晨 5 点，在不同夜晚听了不止一次' + (since ? '（统计自 ' + homeCustomEsc(since) + ' 起）' : '') + '</p>';
    html += info.night.map(function (item) { return homeCustomSongLine(item, item.nightDays + ' 个夜晚 · 共 ' + item.nights + ' 次'); }).join('');
  } else {
    html += '<p class="hs-empty">' + (since ? '自 ' + homeCustomEsc(since) + ' 起，还没有哪首歌在不同夜晚被反复听到。' : '从现在开始记录深夜的聆听；同一首歌在两个不同的夜晚被听到，就会出现在这里。') + '</p>';
  }
  return html;
}

function homeCustomRenderInsights() {
  var root = document.getElementById('hs-insights');
  if (root) root.innerHTML = homeCustomInsightsHtml(homeCustomStats());
}

function homeCustomTasteInput(moments) {
  var stats = homeCustomStats();
  var songsForNight = typeof listenNightSongs === 'function' ? listenNightSongs(stats.songs, 6) : [];
  var write = moments && typeof listenWriteVsListen === 'function' ? listenWriteVsListen(stats.songs, listenNoteIndex(moments), 6) : null;
  var recent = stats.history.slice(0, 40).map(function (r) {
    return { name: String(r.name || '').slice(0, 80), artist: String(r.artist || '').slice(0, 80), at: new Date(r.playedAt).toISOString().slice(0, 16), listenMin: Math.round((r.listenMs || 0) / 60000), completed: !!r.completed };
  });
  return {
    totalMinutes: Math.round(stats.rollup.totalListenMs / 60000),
    sessions: stats.rollup.sessions || 0,
    topSongs: stats.songs.slice(0, 15).map(function (s) { return { name: String(s.name || '').slice(0, 80), artist: String(s.artist || '').slice(0, 80), plays: s.plays || 0, minutes: Math.round((s.listenMs || 0) / 60000) }; }),
    topArtists: stats.artists.slice(0, 12).map(function (a) { return { name: String(a.name || '').slice(0, 80), plays: a.plays || 0, minutes: Math.round((a.listenMs || 0) / 60000) }; }),
    byHour: stats.hours.map(function (ms) { return Math.round(ms / 60000); }),
    last14Days: stats.days.map(function (d) { return { date: d.key, minutes: Math.round(d.ms / 60000) }; }),
    recent: recent,
    nightSongs: songsForNight.map(function (item) {
      return { name: String(item.name || '').slice(0, 80), artist: String(item.artist || '').slice(0, 80), nightDays: item.nightDays, nights: item.nights, minutes: item.minutes, plays: item.plays };
    }),
    notes: write ? {
      totalNotes: write.totalNotes,
      mostWritten: write.mostWritten.map(function (item) { return { name: String(item.name || '').slice(0, 80), artist: String(item.artist || '').slice(0, 80), notes: item.notes, plays: item.plays, minutes: item.minutes }; }),
      listenedNotWritten: write.listenedNotWritten.map(function (item) { return { name: String(item.name || '').slice(0, 80), artist: String(item.artist || '').slice(0, 80), plays: item.plays, minutes: item.minutes }; }),
    } : undefined,
  };
}

function homeCustomReadTaste() {
  try {
    var saved = JSON.parse(localStorage.getItem(HOME_TASTE_CACHE_KEY) || 'null');
    return saved && typeof saved.summary === 'string' ? saved : null;
  } catch (_error) { return null; }
}

function homeCustomRenderTaste(message) {
  var root = document.getElementById('hs-taste-body');
  if (!root) return;
  var saved = homeCustomReadTaste();
  var hasData = homeCustomStats().songs.length > 0;
  var html = '';
  if (message) html += '<p class="hs-error" role="alert">' + homeCustomEsc(message) + '</p>';
  if (homeCustomTasteBusy) {
    html += '<p class="hs-taste-summary hs-live" id="hs-taste-live" aria-live="polite">' + (homeCustomTasteLive ? homeCustomEsc(homeCustomTasteLive) : '<span class="hs-wait">正在读你的聆听记录…</span>') + '<i class="hs-caret" aria-hidden="true"></i></p>';
    html += '<button type="button" class="hs-run hs-stop" id="hs-taste-stop">停止</button>';
    root.innerHTML = html;
    var stop = document.getElementById('hs-taste-stop');
    if (stop) stop.addEventListener('click', function () { if (homeCustomTasteAbort) homeCustomTasteAbort.abort(); });
    return;
  }
  if (saved) {
    html += '<p class="hs-taste-summary">' + homeCustomEsc(saved.summary) + '</p>';
    (saved.points || []).forEach(function (point) { html += '<div class="hs-point"><b>' + homeCustomEsc(point.title) + '</b><span>' + homeCustomEsc(point.body) + '</span></div>'; });
    if (saved.hint) html += '<p class="hs-hint">' + homeCustomEsc(saved.hint) + '</p>';
    html += '<small>' + homeCustomEsc(new Date(saved.at).toLocaleString('zh-CN')) + ' 生成 · 模型对你的聆听记录的解读，仅供参考</small>';
  }
  html += '<button type="button" class="hs-run" id="hs-taste-run"' + (!hasData ? ' disabled' : '') + '>' + (saved ? '重新分析' : '分析我最近的喜好') + '</button>';
  html += '<small class="hs-privacy">点击后，歌名、歌手、播放次数与时段会发送到你配置的模型服务；不会发送账号信息。' + (homeCustomNotesConsent() ? '已授权读取笔记，还会发送每首歌的笔记条数（不含笔记内容）。' : '想让分析结合你的笔记，可在余响「回顾」页勾选「允许 AI 读取我的笔记」。') + '</small>';
  root.innerHTML = html;
  var run = document.getElementById('hs-taste-run');
  if (run) run.addEventListener('click', homeCustomRunTaste);
}

function homeCustomTasteLiveUpdate() {
  var el = document.getElementById('hs-taste-live');
  if (!el) return;
  el.textContent = homeCustomTasteLive;
  var caret = document.createElement('i');
  caret.className = 'hs-caret';
  caret.setAttribute('aria-hidden', 'true');
  el.appendChild(caret);
}

/** 解析 SSE：按空行切事件，兼容 CRLF 与 ":" 注释心跳。 */
async function homeCustomReadSse(response, onEvent, onActivity) {
  var reader = response.body.getReader();
  var decoder = new TextDecoder();
  var buffer = '';
  function flush(block) {
    var event = 'message';
    var data = [];
    block.split('\n').forEach(function (line) {
      if (!line || line.charAt(0) === ':') return;
      var i = line.indexOf(':');
      var field = i < 0 ? line : line.slice(0, i);
      var value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
      if (field === 'event') event = value; else if (field === 'data') data.push(value);
    });
    if (data.length) onEvent(event, data.join('\n'));
  }
  while (true) {
    var chunk = await reader.read();
    if (chunk.done) break;
    onActivity();
    buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
    var idx;
    while ((idx = buffer.indexOf('\n\n')) >= 0) { flush(buffer.slice(0, idx)); buffer = buffer.slice(idx + 2); }
  }
  if (buffer.trim()) flush(buffer);
}

async function homeCustomRunTaste() {
  if (homeCustomTasteBusy) return;
  homeCustomTasteBusy = true;
  homeCustomTasteLive = '';
  var abort = new AbortController();
  homeCustomTasteAbort = abort;
  var idled = false;
  var timer = null;
  function touch() { clearTimeout(timer); timer = setTimeout(function () { idled = true; abort.abort(); }, 60000); }
  homeCustomRenderTaste();
  var message = '';
  var result = null;
  var shareNotes = homeCustomNotesConsent();
  var failure = '';
  try {
    touch();
    var moments = shareNotes ? (await homeCustomLoadMoments()) : null;
    var response = await fetch('/afterglow-api/taste/stream', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(homeCustomTasteInput(moments)), signal: abort.signal,
    });
    if (!response.ok) {
      var body = await response.json().catch(function () { return {}; });
      throw new Error(body.message || '分析失败，请稍后重试。');
    }
    await homeCustomReadSse(response, function (event, raw) {
      var data = {};
      try { data = JSON.parse(raw); } catch (_error) { return; }
      if (event === 'text' && typeof data.text === 'string') { homeCustomTasteLive += data.text; homeCustomTasteLiveUpdate(); }
      else if (event === 'done') result = data;
      else if (event === 'error') failure = data.message || '分析失败，请稍后重试。';
    }, touch);
    if (failure) throw new Error(failure);
    if (!result || typeof result.summary !== 'string') throw new Error('分析失败，请稍后重试。');
    localStorage.setItem(HOME_TASTE_CACHE_KEY, JSON.stringify({ summary: result.summary, points: result.points || [], hint: result.hint || '', at: Date.now() }));
  } catch (error) {
    if (idled) message = '模型 60 秒没有返回，已停止。';
    else if (abort.signal.aborted) message = '';
    else message = error && error.name !== 'TypeError' ? error.message : '服务未启动或连接中断，请稍后重试。';
  } finally {
    clearTimeout(timer);
    homeCustomTasteBusy = false;
    homeCustomTasteAbort = null;
    homeCustomTasteLive = '';
    homeCustomRenderTaste(message);
  }
}

function openHomeStats(opts) {
  var mask = homeCustomMask('home-stats-mask', '聆听统计', 'home-stats-body');
  homeCustomRenderStats();
  homeCustomOpen(mask);
  if (opts && opts.focus === 'taste') {
    var taste = document.getElementById('hs-taste');
    if (taste && taste.scrollIntoView) taste.scrollIntoView({ block: 'center' });
  }
}

/* ---------- 播放顺序 ---------- */
function homeCustomSongTitle(song) {
  return song ? (song.name || song.title || '未知歌曲') : '';
}

function homeCustomQueueChanged(reason) {
  if (typeof safeRenderQueuePanel === 'function') safeRenderQueuePanel(reason, { animate: false, scrollCurrent: false, deferWhenHidden: false });
  if (typeof safeShelfRebuild === 'function') safeShelfRebuild(reason, true);
  if (typeof saveLastPlaybackSnapshot === 'function') saveLastPlaybackSnapshot(true, reason);
  if (typeof renderHomeInsightDock === 'function') renderHomeInsightDock();
  homeCustomRenderOrder();
}

function homeReshuffleQueue() {
  if (!playQueue.length) { if (typeof showToast === 'function') showToast('队列里还没有歌曲'); return; }
  if (playQueue.length < 2) { if (typeof showToast === 'function') showToast('队列里只有一首歌'); return; }
  if (currentIdx < 0 || currentIdx >= playQueue.length) currentIdx = 0;
  reorderQueueForShufflePlaybackOrder(currentIdx, { reason: 'home-reshuffle' });
  if (typeof renderHomeInsightDock === 'function') renderHomeInsightDock();
  homeCustomRenderOrder();
  if (typeof showToast === 'function') showToast('已重新随机排列接下来的歌曲');
}

function homeCustomMoveQueueItem(from, to) {
  if (from === to || from < 0 || to < 0 || from >= playQueue.length || to >= playQueue.length) return;
  var item = playQueue.splice(from, 1)[0];
  playQueue.splice(to, 0, item);
  if (currentIdx === from) currentIdx = to;
  else if (from < currentIdx && to >= currentIdx) currentIdx -= 1;
  else if (from > currentIdx && to <= currentIdx) currentIdx += 1;
  homeCustomQueueChanged('home-order-move');
}

function homeCustomRemoveQueueItem(index) {
  if (index === currentIdx || index < 0 || index >= playQueue.length) return;
  playQueue.splice(index, 1);
  if (index < currentIdx) currentIdx -= 1;
  homeCustomQueueChanged('home-order-remove');
}

function homeCustomSetMode(mode) {
  var guard = 0;
  while (playMode !== mode && guard++ < 3) cyclePlayMode();
  homeCustomRenderOrder();
}

function homeCustomRenderOrder() {
  var body = document.getElementById('home-order-body');
  if (!body) return;
  var modes = [['loop', '顺序循环'], ['shuffle', '随机播放'], ['single', '单曲循环']];
  var html = '<div class="ho-modes" role="radiogroup" aria-label="播放模式">' + modes.map(function (m) {
    return '<button type="button" role="radio" aria-checked="' + (playMode === m[0]) + '" class="' + (playMode === m[0] ? 'active' : '') + '" data-mode="' + m[0] + '">' + m[1] + '</button>';
  }).join('') + '<button type="button" class="ho-reshuffle" data-act="reshuffle"' + (playQueue.length > 1 ? '' : ' disabled') + '>重新随机</button></div>';
  if (!playQueue.length) {
    html += '<p class="hs-empty">队列里还没有歌曲。去音乐库挑选歌曲后，这里可以调整播放顺序。</p>';
  } else {
    html += '<p class="ho-count">共 ' + playQueue.length + ' 首 · 正在播放第 ' + (currentIdx + 1) + ' 首。「重新随机」只重排当前歌曲之后的部分。</p><ol class="ho-list">';
    playQueue.forEach(function (song, index) {
      var isCurrent = index === currentIdx;
      html += '<li class="' + (isCurrent ? 'current' : '') + '" data-index="' + index + '"><span class="ho-idx">' + (isCurrent ? '▶' : index + 1) + '</span>' +
        '<span class="ho-title"><b>' + homeCustomEsc(homeCustomSongTitle(song)) + '</b><i>' + homeCustomEsc(typeof homeDashboardSubtitle === 'function' ? homeDashboardSubtitle(song) : (song.artist || '')) + '</i></span>' +
        '<span class="ho-acts">' +
        '<button type="button" data-act="next" title="下一首就播这个"' + (index <= currentIdx + 1 ? ' disabled' : '') + '>设为下一首</button>' +
        '<button type="button" data-act="up" title="上移" aria-label="上移"' + (index === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button type="button" data-act="down" title="下移" aria-label="下移"' + (index === playQueue.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button type="button" data-act="remove" title="移出队列" aria-label="移出队列"' + (isCurrent ? ' disabled' : '') + '>×</button></span></li>';
    });
    html += '</ol>';
  }
  var scroller = body.querySelector('.ho-list');
  var scrollTop = scroller ? scroller.scrollTop : 0;
  body.innerHTML = html;
  var list = body.querySelector('.ho-list');
  if (list) {
    if (scroller) list.scrollTop = scrollTop;
    else {
      var current = list.querySelector('li.current');
      if (current) list.scrollTop = Math.max(0, current.offsetTop - 80);
    }
  }
}

function openHomeOrder() {
  if (!playQueue.length) {
    if (typeof openHomeDashboardLibrary === 'function') openHomeDashboardLibrary();
    return;
  }
  var mask = homeCustomMask('home-order-mask', '播放顺序', 'home-order-body');
  var body = document.getElementById('home-order-body');
  if (body && !body.dataset.bound) {
    body.dataset.bound = '1';
    body.addEventListener('click', function (event) {
      var button = event.target.closest('button');
      if (!button || button.disabled) return;
      if (button.dataset.mode) { homeCustomSetMode(button.dataset.mode); return; }
      if (button.dataset.act === 'reshuffle') { homeReshuffleQueue(); return; }
      var row = button.closest('li[data-index]');
      if (!row) return;
      var index = Number(row.dataset.index);
      if (button.dataset.act === 'up') homeCustomMoveQueueItem(index, index - 1);
      else if (button.dataset.act === 'down') homeCustomMoveQueueItem(index, index + 1);
      else if (button.dataset.act === 'remove') homeCustomRemoveQueueItem(index);
      else if (button.dataset.act === 'next') homeCustomMoveQueueItem(index, Math.min(playQueue.length - 1, currentIdx + 1));
    });
  }
  homeCustomOrderOpen = true;
  homeCustomRenderOrder();
  homeCustomOpen(mask);
}
