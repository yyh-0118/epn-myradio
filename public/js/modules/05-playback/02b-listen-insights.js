/* 聆听洞察：纯函数，不碰 DOM。
 * 1) 深夜（23 点到次日 5 点）在不同夜晚反复听的歌；
 * 2) 把听歌统计和随笔条数对齐（写得最多的歌、听得多却没写过的歌）。
 * 依赖：无。02-listen-stats.js 在结束一次聆听时会调用 listenRecordNight。 */
var LISTEN_NIGHT_FROM_HOUR = 23;
var LISTEN_NIGHT_TO_HOUR = 5;
var LISTEN_NIGHT_MIN_NIGHTS = 2;
var LISTEN_UNWRITTEN_MIN_PLAYS = 3;

function listenIsNightHour(hour) {
  return hour >= LISTEN_NIGHT_FROM_HOUR || hour < LISTEN_NIGHT_TO_HOUR;
}

/* 凌晨 0-5 点算前一天晚上的延续，这样「周五深夜听到周六凌晨」只算一个夜晚。 */
function listenNightKey(timestamp) {
  var date = new Date(timestamp);
  if (date.getHours() < LISTEN_NIGHT_TO_HOUR) date.setDate(date.getDate() - 1);
  var month = String(date.getMonth() + 1).padStart(2, '0');
  var day = String(date.getDate()).padStart(2, '0');
  return date.getFullYear() + '-' + month + '-' + day;
}

/* 一次有效聆听结束时累加到该曲目的统计上；按开始时间判断是不是深夜。 */
function listenRecordNight(songStat, startedAt, listenMs) {
  if (!songStat || !Number.isFinite(Number(startedAt)) || !(Number(startedAt) > 0)) return songStat;
  if (!listenIsNightHour(new Date(Number(startedAt)).getHours())) return songStat;
  var nightKey = listenNightKey(Number(startedAt));
  songStat.night = (Number(songStat.night) || 0) + 1;
  songStat.nightMs = (Number(songStat.nightMs) || 0) + Math.max(0, Number(listenMs) || 0);
  if (songStat.lastNightKey !== nightKey) songStat.nightDays = (Number(songStat.nightDays) || 0) + 1;
  songStat.lastNightKey = nightKey;
  return songStat;
}

function listenNightSongs(songs, limit) {
  return (songs || [])
    .filter(function (song) { return song && (Number(song.nightDays) || 0) >= LISTEN_NIGHT_MIN_NIGHTS; })
    .sort(function (a, b) { return (b.nightDays - a.nightDays) || ((b.night || 0) - (a.night || 0)) || ((b.nightMs || 0) - (a.nightMs || 0)); })
    .slice(0, limit || 6)
    .map(function (song) {
      return {
        key: song.key || '', name: song.name || '未知歌曲', artist: song.artist || '',
        nightDays: song.nightDays || 0, nights: song.night || 0,
        minutes: Math.round((song.nightMs || 0) / 60000), plays: song.plays || 0,
      };
    });
}

/* AI 提问行（「> …」或旧版「问：…」）不是用户写的话，不算笔记内容。 */
function listenNoteText(body) {
  return String(body || '').replace(/^[ \t]*(?:>|问[：:]).*$/gm, '').trim();
}

/* moments → 以曲目 key（与聆听统计的 queueItemKey 相同）为索引的笔记条数。只统计有文字的笔记。 */
function listenNoteIndex(moments) {
  var index = {};
  (Array.isArray(moments) ? moments : []).forEach(function (moment) {
    if (!moment || !moment.trackId) return;
    var item = index[moment.trackId] || { key: moment.trackId, name: '', artist: '', notes: 0, chars: 0, lastAt: '' };
    item.name = item.name || moment.trackTitle || '';
    item.artist = item.artist || moment.artist || '';
    var text = listenNoteText(moment.body);
    if (text) { item.notes += 1; item.chars += text.length; }
    var at = String(moment.updatedAt || moment.createdAt || '');
    if (at > item.lastAt) item.lastAt = at;
    index[moment.trackId] = item;
  });
  return index;
}

function listenWriteVsListen(songs, noteIndex, limit) {
  var cap = limit || 6;
  var byKey = {};
  (songs || []).forEach(function (song) { if (song && song.key) byKey[song.key] = song; });
  var notes = noteIndex || {};
  var mostWritten = Object.keys(notes).map(function (key) { return notes[key]; })
    .filter(function (item) { return item.notes > 0; })
    .sort(function (a, b) { return (b.notes - a.notes) || (b.chars - a.chars) || (b.lastAt > a.lastAt ? 1 : -1); })
    .slice(0, cap)
    .map(function (item) {
      var song = byKey[item.key] || {};
      return {
        key: item.key, name: song.name || item.name || '未知歌曲', artist: song.artist || item.artist || '',
        notes: item.notes, plays: song.plays || 0, minutes: Math.round((song.listenMs || 0) / 60000),
      };
    });
  var listenedNotWritten = (songs || [])
    .filter(function (song) { return song && song.key && (song.plays || 0) >= LISTEN_UNWRITTEN_MIN_PLAYS && !(notes[song.key] && notes[song.key].notes > 0); })
    .sort(function (a, b) { return ((b.plays || 0) - (a.plays || 0)) || ((b.listenMs || 0) - (a.listenMs || 0)); })
    .slice(0, cap)
    .map(function (song) {
      return { key: song.key, name: song.name || '未知歌曲', artist: song.artist || '', plays: song.plays || 0, minutes: Math.round((song.listenMs || 0) / 60000) };
    });
  var totalNotes = Object.keys(notes).reduce(function (sum, key) { return sum + notes[key].notes; }, 0);
  return { totalNotes: totalNotes, mostWritten: mostWritten, listenedNotWritten: listenedNotWritten };
}
