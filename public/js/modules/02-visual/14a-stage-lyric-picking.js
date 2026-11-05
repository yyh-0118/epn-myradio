// ============================================================
// Semantic picking for visible Three.js lyric rows.
// The visual layer only reports a lyricsLines index; product actions live elsewhere.
var stageLyricPickRaycaster = new THREE.Raycaster();
var stageLyricPickNdc = new THREE.Vector2();
var stageLyricPickPointer = { active: false, pointerId: -1, x: 0, y: 0, at: 0, lineIndex: -1 };

function stageLyricPickingAllowed() {
  if (!renderer || !renderer.domElement || !camera || !stageLyrics || !stageLyrics.current) return false;
  if (!fx || !fx.particleLyrics || !Array.isArray(lyricsLines) || !lyricsLines.length) return false;
  if (document.body.classList.contains('splash-active') || document.body.classList.contains('afterglow-workbench-open')) return false;
  if (freeCamera && (freeCamera.active || freeCamera.locked)) return false;
  if (document.pointerLockElement) return false;
  if (typeof shelfManager !== 'undefined' && shelfManager && shelfManager.getMode && shelfManager.getMode() !== 'off') return false;
  return true;
}

function stageLyricPickRows() {
  var data = stageLyrics.current && stageLyrics.current.userData && stageLyrics.current.userData.lyric;
  if (!data || !Array.isArray(data.rowLayers)) return [];
  return data.rowLayers.filter(function (row) {
    return !!(
      row && row.mesh && row.mesh.visible && row.renderWindowActive === true
      && row.renderLineUploaded === true && isFinite(Number(row.lineIndex))
    );
  });
}

function stageLyricPickAt(clientX, clientY) {
  if (!stageLyricPickingAllowed()) return null;
  var canvas = renderer.domElement;
  var rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  stageLyricPickNdc.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1
  );
  stageLyricPickRaycaster.setFromCamera(stageLyricPickNdc, camera);
  var rows = stageLyricPickRows();
  if (!rows.length) return null;
  var byMeshId = {};
  var objects = rows.map(function (row) { byMeshId[row.mesh.id] = row; return row.mesh; });
  var hits = stageLyricPickRaycaster.intersectObjects(objects, false);
  for (var i = 0; i < hits.length; i++) {
    var row = byMeshId[hits[i].object && hits[i].object.id];
    if (!row) continue;
    var rawIndex = row.isTranslation && isFinite(Number(row.parentIndex)) ? Number(row.parentIndex) : Number(row.lineIndex);
    var lineIndex = Math.round(rawIndex);
    if (lineIndex < 0 || lineIndex >= lyricsLines.length) continue;
    return { row: row, lineIndex: lineIndex, line: lyricsLines[lineIndex] };
  }
  return null;
}

function resetStageLyricPickPointer() {
  stageLyricPickPointer.active = false;
  stageLyricPickPointer.pointerId = -1;
  stageLyricPickPointer.lineIndex = -1;
}

renderer.domElement.addEventListener('pointerdown', function (event) {
  resetStageLyricPickPointer();
  if (!stageLyricPickingAllowed() || event.isPrimary === false || event.button !== 0) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  var hit = stageLyricPickAt(event.clientX, event.clientY);
  if (!hit) return;
  stageLyricPickPointer.active = true;
  stageLyricPickPointer.pointerId = event.pointerId;
  stageLyricPickPointer.x = event.clientX;
  stageLyricPickPointer.y = event.clientY;
  stageLyricPickPointer.at = performance.now();
  stageLyricPickPointer.lineIndex = hit.lineIndex;
}, true);

window.addEventListener('pointerup', function (event) {
  if (!stageLyricPickPointer.active || event.pointerId !== stageLyricPickPointer.pointerId) return;
  var moved = Math.hypot(event.clientX - stageLyricPickPointer.x, event.clientY - stageLyricPickPointer.y);
  var elapsed = performance.now() - stageLyricPickPointer.at;
  var expectedIndex = stageLyricPickPointer.lineIndex;
  resetStageLyricPickPointer();
  if (moved > 6 || elapsed > 650 || (typeof mouseDownAt !== 'undefined' && mouseDownAt.hadDrag)) return;
  var hit = stageLyricPickAt(event.clientX, event.clientY);
  if (!hit || hit.lineIndex !== expectedIndex) return;
  window.dispatchEvent(new CustomEvent('mineradio:stage-lyric-pick', {
    detail: {
      lineIndex: hit.lineIndex,
      lineId: 'line-' + (hit.lineIndex + 1),
      text: String(hit.line && hit.line.text || ''),
      time: hit.line && isFinite(Number(hit.line.t)) ? Math.max(0, Number(hit.line.t)) : null,
    }
  }));
}, true);
window.addEventListener('pointercancel', resetStageLyricPickPointer, true);
window.addEventListener('blur', resetStageLyricPickPointer);
