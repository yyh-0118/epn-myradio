;(function () {
  'use strict';

  var CHANNEL = 'mineradio.afterglow';
  var VERSION = 2;
  var root = null;
  var frame = null;
  var captureDock = null;
  var port = null;
  var sessionId = '';
  var seq = 0;
  var childSeq = -1;
  var pendingCapture = null;
  var stateTimer = 0;
  var lastTrackKey = '';
  var lastLineIndex = -99;
  var epnAnalysisAvailable = false;
  var selectedStageLineId = '';
  var selectedStageLineUntil = 0;
  var transitionTimer = 0;
  var pendingFlushRequests = {};

  function randomId(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  function currentSong() {
    try { return typeof currentCoverSong === 'function' ? currentCoverSong() : (currentIdx >= 0 && playQueue[currentIdx] ? playQueue[currentIdx] : currentLocalSong); }
    catch (_) { return null; }
  }

  function providerOf(song) {
    if (!song) return '';
    if (song.type === 'local' || song.localKey) return 'local';
    if (song.type === 'podcast' || song.source === 'podcast') return 'podcast';
    try { return typeof songProviderKey === 'function' ? songProviderKey(song) : String(song.provider || song.source || 'netease'); }
    catch (_) { return String(song.provider || song.source || 'netease'); }
  }

  function sourceIdOf(song) {
    return String(song && (song.spotifyId || song.mid || song.songmid || song.hash || song.fileHash || song.audioHash || song.providerSongId || song.programId || song.localKey || song.id) || '');
  }

  function trackKeyOf(song) {
    if (!song) return '';
    try { if (typeof queueItemKey === 'function') return queueItemKey(song); } catch (_) {}
    return providerOf(song) + ':' + (sourceIdOf(song) || String(song.name || song.title || '') + '|' + String(song.artist || song.author || ''));
  }

  function cleanNumber(value, fallback) {
    value = Number(value);
    return isFinite(value) ? value : fallback;
  }

  function safePlaybackRef(song) {
    if (!song || typeof song !== 'object') return null;
    var ref = {};
    var keys = [
      'provider', 'source', 'type', 'id', 'mid', 'songmid', 'mediaMid', 'qqId',
      'spotifyId', 'spotifyUri', 'uri', 'hash', 'fileHash', 'audioHash', 'albumId', 'albumMid',
      'albumAudioId', 'mixSongId', 'hqHash', 'sqHash', 'resHash', 'providerSongId',
      'programId', 'radioId', 'localKey', 'localFileId', 'name', 'title', 'artist', 'album',
      'duration', 'durationMs', 'dt', 'fee', 'playable'
    ];
    keys.forEach(function (key) {
      var value = song[key];
      if (value == null || value === '') return;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') ref[key] = value;
    });
    return ref;
  }

  function hostTrack(song) {
    if (!song) return null;
    var duration = audio && isFinite(audio.duration) && audio.duration > 0 ? audio.duration : cleanNumber(song.duration, 0);
    if (duration > 100000) duration /= 1000;
    return {
      id: trackKeyOf(song), provider: providerOf(song), sourceId: sourceIdOf(song),
      title: String(song.name || song.title || '未命名歌曲'), artist: String(song.artist || song.ar || song.author || '未知歌手'),
      duration: Math.max(0, duration), playbackRef: safePlaybackRef(song)
    };
  }

  function hostLyrics() {
    var lines = Array.isArray(lyricsLines) ? lyricsLines : [];
    return lines.slice(0, 1000).map(function (line, index) {
      var item = {
        id: 'line-' + (index + 1), text: String(line && line.text || ''),
        t: line && isFinite(Number(line.t)) ? Math.max(0, Number(line.t)) : null
      };
      if (line && isFinite(Number(line.duration))) item.duration = Math.max(0, Number(line.duration));
      if (line && Array.isArray(line.words)) {
        item.words = line.words.slice(0, 500).map(function (word) {
          return { text: String(word.text || ''), t: cleanNumber(word.t, 0), d: cleanNumber(word.d, 0), c0: cleanNumber(word.c0, 0), c1: cleanNumber(word.c1, 0) };
        });
      }
      return item;
    });
  }

  function currentLineIndex(lines) {
    var index = typeof stageLyrics !== 'undefined' && stageLyrics && isFinite(stageLyrics.currentIdx) ? Number(stageLyrics.currentIdx) : -1;
    if (index >= 0 && index < lines.length) return index;
    var time = audio && isFinite(audio.currentTime) ? audio.currentTime : 0;
    try { if (typeof getAdjustedLyricPlaybackTime === 'function') time = getAdjustedLyricPlaybackTime(time); } catch (_) {}
    for (var i = 0; i < lines.length; i++) if (lines[i].t != null && lines[i].t <= time) index = i;
    return index >= 0 && index < lines.length ? index : -1;
  }

  function snapshot() {
    var song = currentSong();
    var track = hostTrack(song);
    var lines = hostLyrics();
    var duration = audio && isFinite(audio.duration) ? audio.duration : track && track.duration || 0;
    return {
      capabilities: {
        seek: true, play: true, pause: true, capture: true, playTrack: true,
        epnAnalysis: epnAnalysisAvailable,
        persistentStorage: !!(window.desktopWindow
          && typeof window.desktopWindow.afterglowListMoments === 'function'
          && typeof window.desktopWindow.afterglowSaveMoment === 'function'),
        notebookArchive: !!(window.desktopWindow
          && typeof window.desktopWindow.afterglowExportNotebook === 'function'
          && typeof window.desktopWindow.afterglowPrepareImport === 'function'),
        backupRestore: !!(window.desktopWindow
          && typeof window.desktopWindow.afterglowListBackups === 'function'
          && typeof window.desktopWindow.afterglowRestoreBackup === 'function'),
        closeFlush: true
      },
      track: track,
      lyrics: lines,
      playback: {
        time: audio && isFinite(audio.currentTime) ? audio.currentTime : 0,
        duration: Math.max(0, cleanNumber(duration, 0)),
        playing: !!(audio && !audio.paused && !audio.ended), rate: audio && isFinite(audio.playbackRate) ? audio.playbackRate : 1,
        sampledAt: Date.now()
      }
    };
  }

  function envelope(type, payload, requestId) {
    var message = { channel: CHANNEL, version: VERSION, sessionId: sessionId, seq: ++seq, type: type, payload: payload };
    if (requestId) message.requestId = requestId;
    return message;
  }

  function send(type, payload, requestId) {
    if (!port || !sessionId) return false;
    try { port.postMessage(envelope(type, payload, requestId)); return true; }
    catch (_) { disconnect(); return false; }
  }

  function sendSnapshot(type) { send(type || 'host.snapshot', snapshot()); }

  function disconnect() {
    Object.keys(pendingFlushRequests).forEach(function (requestId) {
      var pending = pendingFlushRequests[requestId];
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error: 'WORKBENCH_DISCONNECTED' });
      delete pendingFlushRequests[requestId];
    });
    if (port) { try { port.close(); } catch (_) {} }
    port = null; sessionId = ''; childSeq = -1;
    clearInterval(stateTimer); stateTimer = 0;
  }

  function connectChild() {
    if (!frame || !frame.contentWindow || port) return;
    var channel = new MessageChannel();
    disconnect();
    port = channel.port1;
    sessionId = randomId('session');
    seq = 0;
    childSeq = -1;
    port.onmessage = onChildMessage;
    port.start();
    frame.contentWindow.postMessage({ channel: CHANNEL, version: VERSION, sessionId: sessionId, seq: 0, type: 'host.connect' }, window.location.origin, [channel.port2]);
    stateTimer = setInterval(function () { if (root && root.classList.contains('is-open')) sendSnapshot('host.state'); }, 500);
  }

  function onWindowMessage(event) {
    if (!frame || event.source !== frame.contentWindow || event.origin !== window.location.origin) return;
    var message = event.data || {};
    if (message.channel !== CHANNEL || message.version !== VERSION || message.type !== 'child.ready') return;
    if (!port) connectChild();
  }

  function capturePayload(lineId, reason) {
    var snap = snapshot();
    if (!snap.track) return null;
    var index = -1;
    if (lineId) index = snap.lyrics.findIndex(function (line) { return line.id === lineId; });
    if (index < 0) index = currentLineIndex(snap.lyrics);
    return {
      commandId: randomId('capture'), track: snap.track, time: snap.playback.time, capturedAt: Date.now(),
      line: index >= 0 ? snap.lyrics[index] : undefined, reason: reason || 'host-button'
    };
  }

  function requestCapture(lineId, reason) {
    var payload = capturePayload(lineId, reason);
    if (!payload) {
      if (typeof showToast === 'function') showToast('先播放一首歌，再留下这个瞬间');
      return;
    }
    pendingCapture = payload;
    openWorkbench();
    if (port) {
      sendSnapshot('host.snapshot');
      send('host.capture', pendingCapture);
      pendingCapture = null;
    }
  }

  function handleStorageRequest(message) {
    var requestId = String(message.requestId || '');
    var request = message.payload || {};
    var operation = String(request.operation || '');
    var api = window.desktopWindow;
    var action = null;
    if (api) {
      if (operation === 'listMoments' && typeof api.afterglowListMoments === 'function') action = function () { return api.afterglowListMoments(); };
      if (operation === 'saveMoment' && typeof api.afterglowSaveMoment === 'function') action = function () { return api.afterglowSaveMoment(request.payload); };
      if (operation === 'deleteMoment' && typeof api.afterglowDeleteMoment === 'function') action = function () { return api.afterglowDeleteMoment(String(request.payload || '')); };
      if (operation === 'listTracks' && typeof api.afterglowListTrackSnapshots === 'function') action = function () { return api.afterglowListTrackSnapshots(); };
      if (operation === 'saveTrack' && typeof api.afterglowSaveTrackSnapshot === 'function') action = function () { return api.afterglowSaveTrackSnapshot(request.payload); };
      if (operation === 'exportNotebook' && typeof api.afterglowExportNotebook === 'function') action = function () { return api.afterglowExportNotebook(); };
      if (operation === 'prepareImport' && typeof api.afterglowPrepareImport === 'function') action = function () { return api.afterglowPrepareImport(); };
      if (operation === 'commitImport' && typeof api.afterglowCommitImport === 'function') action = function () { return api.afterglowCommitImport(request.payload); };
      if (operation === 'listBackups' && typeof api.afterglowListBackups === 'function') action = function () { return api.afterglowListBackups(); };
      if (operation === 'restoreBackup' && typeof api.afterglowRestoreBackup === 'function') action = function () { return api.afterglowRestoreBackup(request.payload); };
      if (operation === 'acknowledgeRecovery' && typeof api.afterglowAcknowledgeRecovery === 'function') action = function () { return api.afterglowAcknowledgeRecovery(); };
    }
    if (!requestId || !action) {
      send('host.storage.result', { ok: false, error: action ? 'INVALID_STORAGE_REQUEST' : 'PERSISTENT_STORAGE_UNAVAILABLE' }, requestId);
      return;
    }
    Promise.resolve().then(action).then(function (result) {
      send('host.storage.result', result && typeof result === 'object' ? result : { ok: false, error: 'INVALID_STORAGE_RESPONSE' }, requestId);
    }).catch(function () {
      send('host.storage.result', { ok: false, error: 'AFTERGLOW_STORE_FAILED' }, requestId);
    });
  }

  function normalizedText(value) { return String(value || '').trim().toLocaleLowerCase(); }

  function songMatchesTrack(song, track) {
    if (!song || !track) return false;
    var provider = providerOf(song);
    var sourceId = sourceIdOf(song);
    if (track.id && trackKeyOf(song) === String(track.id) && (!track.provider || provider === String(track.provider))) return true;
    if (track.provider && track.sourceId && provider === String(track.provider) && sourceId === String(track.sourceId)) return true;
    var songDuration = cleanNumber(song.durationMs || song.dt || song.duration, 0);
    if (songDuration > 100000) songDuration /= 1000;
    return !!(
      (!track.provider || provider === String(track.provider))
      && normalizedText(song.name || song.title) === normalizedText(track.title)
      && normalizedText(song.artist || song.author) === normalizedText(track.artist)
      && (!track.duration || !songDuration || Math.abs(songDuration - Number(track.duration)) < 3)
    );
  }

  function findPlayableTrack(track) {
    var lists = [Array.isArray(playQueue) ? playQueue : [], Array.isArray(persistentLocalLibraryTracks) ? persistentLocalLibraryTracks : []];
    var playbackSnapshot = typeof readLastPlaybackSnapshot === 'function' ? readLastPlaybackSnapshot() : null;
    if (playbackSnapshot) {
      if (Array.isArray(playbackSnapshot.queue)) lists.push(playbackSnapshot.queue);
      if (playbackSnapshot.current) lists.push([playbackSnapshot.current]);
    }
    for (var listIndex = 0; listIndex < lists.length; listIndex++) {
      for (var index = 0; index < lists[listIndex].length; index++) {
        if (songMatchesTrack(lists[listIndex][index], track)) return lists[listIndex][index];
      }
    }
    var ref = track && track.playbackRef;
    if (!ref || typeof ref !== 'object') return null;
    var candidate = Object.assign({}, ref);
    candidate.provider = candidate.provider || track.provider;
    candidate.source = candidate.source || track.provider;
    candidate.name = candidate.name || candidate.title || track.title;
    candidate.title = candidate.title || candidate.name;
    candidate.artist = candidate.artist || track.artist;
    candidate.duration = candidate.duration || track.duration;
    if (candidate.provider === 'local' || candidate.type === 'local' || candidate.localKey) return null;
    return sourceIdOf(candidate) ? candidate : null;
  }

  function ensureSongInQueue(song) {
    for (var i = 0; i < playQueue.length; i++) if (songMatchesTrack(playQueue[i], hostTrack(song))) return i;
    if (typeof queueSong === 'function') {
      var queued = queueSong(song);
      if (isFinite(Number(queued))) return Number(queued);
    }
    playQueue.push(typeof hydrateCustomCover === 'function' ? hydrateCustomCover(Object.assign({}, song)) : Object.assign({}, song));
    return playQueue.length - 1;
  }

  async function restoreTrackAndSeek(track, target, autoplay) {
    var current = hostTrack(currentSong());
    if (current && songMatchesTrack(currentSong(), track)) {
      if (typeof commitProgressSeek === 'function') commitProgressSeek(target, autoplay);
      else if (audio) { audio.currentTime = target; if (autoplay && audio.paused && typeof playAudio === 'function') playAudio({ manual: true }); }
      return { ok: true, mode: 'seek', trackId: current.id };
    }
    var song = findPlayableTrack(track);
    if (!song) return { ok: false, error: track && track.provider === 'local' ? 'LOCAL_TRACK_NOT_AVAILABLE' : 'TRACK_NOT_AVAILABLE' };
    var index = ensureSongInQueue(song);
    if (index < 0 || typeof playQueueAt !== 'function') return { ok: false, error: 'PLAYBACK_UNAVAILABLE' };
    var expectedKey = trackKeyOf(playQueue[index]);
    var started = await playQueueAt(index, { manual: true, resumeAt: target, preserveHomeState: true, skipShuffleOrder: true });
    var activeSong = currentSong();
    if (started !== true || !activeSong || trackKeyOf(activeSong) !== expectedKey) return { ok: false, error: 'TRACK_START_FAILED' };
    if (!autoplay && audio && !audio.paused) audio.pause();
    return { ok: true, mode: 'track', trackId: trackKeyOf(activeSong) };
  }

  function onChildMessage(event) {
    var message = event.data || {};
    if (message.channel !== CHANNEL || message.version !== VERSION || message.sessionId !== sessionId || !isFinite(message.seq) || message.seq <= childSeq) return;
    childSeq = message.seq;
    if (message.type === 'child.connected') {
      sendSnapshot('host.snapshot');
      if (pendingCapture) { send('host.capture', pendingCapture); pendingCapture = null; }
      return;
    }
    if (message.type === 'child.flush.result' && message.requestId) {
      var flushPending = pendingFlushRequests[message.requestId];
      if (flushPending) {
        clearTimeout(flushPending.timer);
        delete pendingFlushRequests[message.requestId];
        flushPending.resolve(message.payload && typeof message.payload === 'object' ? message.payload : { ok: false, error: 'INVALID_FLUSH_RESPONSE' });
      }
      return;
    }
    if (message.type === 'child.close' || message.type === 'child.close.request') { requestCloseWorkbench('child-close'); return; }
    if (message.type === 'child.storage.request') { handleStorageRequest(message); return; }
    if (message.type === 'child.capture.request') {
      var requested = message.payload && typeof message.payload.lineId === 'string' ? message.payload.lineId : '';
      var capture = capturePayload(requested, 'child-request');
      if (capture) send('host.capture', capture);
      return;
    }
    if (message.type === 'child.restoreTrack') {
      var payload = message.payload || {};
      var target = Math.max(0, cleanNumber(payload.time, 0));
      Promise.resolve(restoreTrackAndSeek(payload.track || {}, target, !!payload.autoplay)).then(function (result) {
        if (!result.ok && typeof showToast === 'function') {
          showToast(result.error === 'LOCAL_TRACK_NOT_AVAILABLE' ? '本地音频已不在曲库，请重新导入' : '暂时找不到这首歌，请先在 Mineradio 中播放一次');
        }
        send('host.playback.result', result, message.requestId);
        if (result.ok) sendSnapshot('host.state');
      }).catch(function () {
        if (typeof showToast === 'function') showToast('回听失败，请稍后重试');
        send('host.playback.result', { ok: false, error: 'TRACK_START_FAILED' }, message.requestId);
      });
      return;
    }
    if (message.type === 'child.seek') {
      var current = hostTrack(currentSong());
      var seekPayload = message.payload || {};
      if (!current || seekPayload.trackId !== current.id) return;
      var seekTarget = Math.max(0, cleanNumber(seekPayload.time, 0));
      if (typeof commitProgressSeek === 'function') commitProgressSeek(seekTarget, !!seekPayload.autoplay);
      else if (audio) audio.currentTime = seekTarget;
      if (seekPayload.autoplay && audio && audio.paused && typeof playAudio === 'function') playAudio({ manual: true });
      return;
    }
    if (message.type === 'child.play' && audio && audio.paused && typeof playAudio === 'function') { playAudio({ manual: true }); return; }
    if (message.type === 'child.pause' && audio && !audio.paused && typeof togglePlay === 'function') togglePlay();
  }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function positionBookTransition() {
    if (!root) return;
    var rect = captureDock && captureDock.getBoundingClientRect ? captureDock.getBoundingClientRect() : null;
    var x = rect ? rect.left + rect.width * 0.5 : window.innerWidth * 0.72;
    var y = rect ? rect.top + rect.height * 0.5 : window.innerHeight * 0.72;
    root.style.setProperty('--afterglow-origin-x', x + 'px');
    root.style.setProperty('--afterglow-origin-y', y + 'px');
  }

  function openWorkbench() {
    if (!root || !frame) return;
    clearTimeout(transitionTimer);
    positionBookTransition();
    root.classList.remove('is-closing', 'is-opening');
    root.classList.add('is-open');
    root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('afterglow-workbench-open');
    if (!frame.getAttribute('src')) frame.setAttribute('src', 'afterglow/index.html?host=mineradio');
    if (!prefersReducedMotion()) {
      requestAnimationFrame(function () { if (root && root.classList.contains('is-open')) root.classList.add('is-opening'); });
      transitionTimer = setTimeout(function () { if (root) root.classList.remove('is-opening'); }, 760);
    }
    if (port) sendSnapshot('host.snapshot');
  }

  function requestChildFlush(reason, timeout) {
    if (!port || !sessionId) return Promise.resolve({ ok: true });
    var requestId = randomId('flush');
    return new Promise(function (resolve) {
      var timer = setTimeout(function () {
        delete pendingFlushRequests[requestId];
        resolve({ ok: false, error: 'FLUSH_TIMEOUT' });
      }, Math.max(500, Number(timeout) || 3500));
      pendingFlushRequests[requestId] = { resolve: resolve, timer: timer };
      if (!send('host.flush.request', { reason: String(reason || 'host-request') }, requestId)) {
        clearTimeout(timer);
        delete pendingFlushRequests[requestId];
        resolve({ ok: false, error: 'WORKBENCH_DISCONNECTED' });
      }
    });
  }

  function finishCloseWorkbench() {
    if (!root || !root.classList.contains('is-open')) return;
    clearTimeout(transitionTimer);
    if (prefersReducedMotion()) {
      root.classList.remove('is-open', 'is-opening', 'is-closing');
      root.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('afterglow-workbench-open');
      return;
    }
    root.classList.remove('is-opening');
    root.classList.add('is-closing');
    transitionTimer = setTimeout(function () {
      if (!root) return;
      root.classList.remove('is-open', 'is-closing');
      root.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('afterglow-workbench-open');
    }, 260);
  }

  function requestCloseWorkbench(reason) {
    if (!root || !root.classList.contains('is-open')) return Promise.resolve({ ok: true });
    return requestChildFlush(reason || 'close', 3500).then(function (result) {
      if (result && result.ok) finishCloseWorkbench();
      else if (typeof showToast === 'function') showToast('笔记尚未保存，工作台已保持打开');
      return result;
    });
  }

  function checkAnalysisHealth() {
    fetch('/afterglow-api/health', { cache: 'no-store', signal: AbortSignal.timeout(2500) })
      .then(function (response) { if (!response.ok) throw new Error('unavailable'); return response.json(); })
      .then(function (body) {
        var available = !!(body && body.ok && body.service === 'afterglow-analysis');
        if (available !== epnAnalysisAvailable) { epnAnalysisAvailable = available; sendSnapshot('host.state'); }
      })
      .catch(function () {
        if (epnAnalysisAvailable) { epnAnalysisAvailable = false; sendSnapshot('host.state'); }
      });
  }

  var DOCK_POS_KEY = 'mineradio-afterglow-dock-pos-v1';
  var DOCK_MARGIN = 8;
  var dockDrag = { active: false, moved: false, suppressClick: false, pointerId: null, x: 0, y: 0, right: 0, bottom: 0 };

  function clampDockOffsets(right, bottom) {
    var maxRight = Math.max(DOCK_MARGIN, window.innerWidth - captureDock.offsetWidth - DOCK_MARGIN);
    var maxBottom = Math.max(DOCK_MARGIN, window.innerHeight - captureDock.offsetHeight - DOCK_MARGIN);
    return {
      right: Math.round(Math.min(maxRight, Math.max(DOCK_MARGIN, right))),
      bottom: Math.round(Math.min(maxBottom, Math.max(DOCK_MARGIN, bottom)))
    };
  }

  function applyDockOffsets(offsets) {
    captureDock.style.right = offsets.right + 'px';
    captureDock.style.bottom = offsets.bottom + 'px';
  }

  function readSavedDockOffsets() {
    try {
      var saved = JSON.parse(localStorage.getItem(DOCK_POS_KEY) || 'null');
      if (saved && isFinite(saved.right) && isFinite(saved.bottom)) return { right: Number(saved.right), bottom: Number(saved.bottom) };
    } catch (_error) { }
    return null;
  }

  function currentDockOffsets() {
    var style = window.getComputedStyle(captureDock);
    return { right: parseFloat(style.right) || 0, bottom: parseFloat(style.bottom) || 0 };
  }

  function restoreDockPosition() {
    var saved = readSavedDockOffsets();
    if (saved) applyDockOffsets(clampDockOffsets(saved.right, saved.bottom));
  }

  function resetDockPosition() {
    try { localStorage.removeItem(DOCK_POS_KEY); } catch (_error) { }
    captureDock.style.right = '';
    captureDock.style.bottom = '';
  }

  function bindDockDrag() {
    captureDock.addEventListener('pointerdown', function (event) {
      if (event.button !== 0 || !event.isPrimary) return;
      var start = currentDockOffsets();
      dockDrag.active = true;
      dockDrag.moved = false;
      dockDrag.pointerId = event.pointerId;
      dockDrag.x = event.clientX;
      dockDrag.y = event.clientY;
      dockDrag.right = start.right;
      dockDrag.bottom = start.bottom;
      try { captureDock.setPointerCapture(event.pointerId); } catch (_error) { }
    });
    captureDock.addEventListener('pointermove', function (event) {
      if (!dockDrag.active || event.pointerId !== dockDrag.pointerId) return;
      var dx = event.clientX - dockDrag.x;
      var dy = event.clientY - dockDrag.y;
      if (!dockDrag.moved) {
        if (Math.hypot(dx, dy) < 5) return;
        dockDrag.moved = true;
        captureDock.classList.add('is-dragging');
      }
      applyDockOffsets(clampDockOffsets(dockDrag.right - dx, dockDrag.bottom - dy));
    });
    function endDrag(event) {
      if (!dockDrag.active || event.pointerId !== dockDrag.pointerId) return;
      dockDrag.active = false;
      try { captureDock.releasePointerCapture(event.pointerId); } catch (_error) { }
      captureDock.classList.remove('is-dragging');
      if (!dockDrag.moved) return;
      dockDrag.suppressClick = true;
      setTimeout(function () { dockDrag.suppressClick = false; }, 60);
      try { localStorage.setItem(DOCK_POS_KEY, JSON.stringify(currentDockOffsets())); } catch (_error) { }
    }
    captureDock.addEventListener('pointerup', endDrag);
    captureDock.addEventListener('pointercancel', endDrag);
    captureDock.addEventListener('contextmenu', function (event) {
      event.preventDefault();
      resetDockPosition();
      if (typeof showToast === 'function') showToast('已恢复记录条的默认位置');
    });
    window.addEventListener('resize', function () {
      if (readSavedDockOffsets()) restoreDockPosition();
      else if (captureDock.style.right) applyDockOffsets(clampDockOffsets(currentDockOffsets().right, currentDockOffsets().bottom));
    });
    restoreDockPosition();
  }

  function updateDock() {
    if (!captureDock) return;
    var song = currentSong();
    var track = hostTrack(song);
    var lines = hostLyrics();
    if (selectedStageLineId && Date.now() > selectedStageLineUntil) selectedStageLineId = '';
    var selectedIndex = selectedStageLineId ? lines.findIndex(function (line) { return line.id === selectedStageLineId; }) : -1;
    var index = selectedIndex >= 0 ? selectedIndex : currentLineIndex(lines);
    var quote = captureDock.querySelector('.afterglow-capture-quote');
    var meta = captureDock.querySelector('.afterglow-capture-meta');
    captureDock.classList.toggle('has-track', !!track);
    captureDock.classList.toggle('has-stage-pick', selectedIndex >= 0);
    captureDock.setAttribute('aria-disabled', track ? 'false' : 'true');
    if (quote) quote.textContent = index >= 0 ? lines[index].text : (track ? '记录正在播放的这一刻' : '播放音乐后开始记录');
    if (meta) meta.textContent = track ? (selectedIndex >= 0 ? '已选中歌词 · 点击打开记录页' : track.title + ' · 记录此刻') : 'AFTERGLOW';
    if (trackKeyOf(song) !== lastTrackKey || index !== lastLineIndex) {
      lastTrackKey = trackKeyOf(song); lastLineIndex = index;
      if (port && root && root.classList.contains('is-open')) sendSnapshot('host.state');
    }
  }

  function buildShell() {
    root = document.createElement('section');
    root.id = 'afterglow-workbench-host';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = '<div class="afterglow-host-backdrop"></div>' +
      '<div class="afterglow-book-proxy" aria-hidden="true">' +
      '<div class="afterglow-book-leaf afterglow-book-leaf-left"><span></span></div>' +
      '<div class="afterglow-book-leaf afterglow-book-leaf-right"><span></span></div>' +
      '<i class="afterglow-book-spine"></i><small>把这一句，展开成一页自己的话</small>' +
      '</div>' +
      '<div class="afterglow-host-frame-shell" role="dialog" aria-modal="true" aria-label="余响创作工作台">' +
      '<div class="afterglow-host-loading"><span></span><strong>正在打开余响工作台</strong><small>音乐仍在 Mineradio 中继续</small></div>' +
      '<iframe id="afterglow-workbench-frame" title="余响创作工作台" allow="clipboard-write"></iframe>' +
      '</div>';
    document.body.appendChild(root);
    frame = root.querySelector('#afterglow-workbench-frame');
    root.querySelector('.afterglow-host-backdrop').addEventListener('click', function () { requestCloseWorkbench('backdrop'); });
    frame.addEventListener('load', function () { disconnect(); });

    captureDock = document.createElement('button');
    captureDock.id = 'afterglow-capture-dock';
    captureDock.type = 'button';
    captureDock.setAttribute('aria-label', '记录当前歌词与播放时刻');
    captureDock.innerHTML = '<span class="afterglow-capture-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 5.5C4 4.7 4.7 4 5.5 4H11c1.7 0 3 1.3 3 3v12c0-1.7-1.3-3-3-3H4V5.5Z"/><path d="M20 5.5C20 4.7 19.3 4 18.5 4H14v15c0-1.7 1.3-3 3-3h3V5.5Z"/></svg></span><span><strong class="afterglow-capture-quote">播放音乐后开始记录</strong><small class="afterglow-capture-meta">AFTERGLOW</small></span>';
    captureDock.title = '拖动可移动位置，右键恢复默认位置';
    captureDock.addEventListener('click', function () {
      if (dockDrag.suppressClick) { dockDrag.suppressClick = false; return; }
      var lineId = selectedStageLineId;
      selectedStageLineId = '';
      selectedStageLineUntil = 0;
      requestCapture(lineId, lineId ? 'stage-lyric' : 'host-button');
    });
    document.body.appendChild(captureDock);
    bindDockDrag();
    updateDock();
    checkAnalysisHealth();
    setInterval(updateDock, 700);
    setInterval(checkAnalysisHealth, 15000);
  }

  window.addEventListener('message', onWindowMessage);
  window.addEventListener('mineradio:stage-lyric-pick', function (event) {
    var detail = event && event.detail || {};
    var lineId = typeof detail.lineId === 'string' ? detail.lineId : '';
    if (!/^line-\d+$/.test(lineId)) return;
    selectedStageLineId = lineId;
    selectedStageLineUntil = Date.now() + 8000;
    updateDock();
    if (captureDock && typeof captureDock.focus === 'function') captureDock.focus({ preventScroll: true });
  });
  window.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && root && root.classList.contains('is-open')) { event.preventDefault(); requestCloseWorkbench('escape'); return; }
    if (event.altKey && event.code === 'KeyN' && !event.repeat) { event.preventDefault(); requestCapture('', 'hotkey'); }
  });

  window.openAfterglowWorkbench = openWorkbench;
  window.flushAfterglowWorkbench = function (reason) { return requestChildFlush(reason || 'main-close', 3500); };
  window.captureAfterglowMoment = function () { requestCapture('', 'host-button'); };
  buildShell();
})();
