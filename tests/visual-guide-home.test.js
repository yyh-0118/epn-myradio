const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appRoot = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(appRoot, ...parts), 'utf8');
const guideScript = read('public', 'js', 'modules', '09-idle-toast-libraries.js');
const sources = [
  read('public', 'index.html'),
  read('public', 'js', 'modules', '05-playback', '03a-home-dashboard.js'),
  read('public', 'js', 'modules', '05-playback', '03b-home-custom.js'),
].join('\n');

function loadSteps(name) {
  const start = guideScript.indexOf(`var ${name} = [`);
  assert.ok(start >= 0, `expected ${name}`);
  const end = guideScript.indexOf('\n];', start) + 3;
  return vm.runInNewContext(`${guideScript.slice(start, end)}; ${name}`);
}

test('guide steps for the homepage point at elements that still exist', () => {
  const steps = loadSteps('visualGuideSteps');
  const homeSteps = steps.filter((step) => step.home);
  assert.ok(homeSteps.length >= 4, 'the tour should cover the new homepage');
  for (const step of steps) {
    const query = step.selector || step.selectorAll;
    if (!query) continue;
    const tokens = query.match(/[#.][A-Za-z][\w-]*/g) || [];
    for (const token of tokens) {
      assert.ok(sources.includes(token.slice(1)), `guide step "${step.title}" references ${token}, which is no longer in the homepage`);
    }
  }
});

test('guide no longer points at the hidden 3D shelf on the default tour and numbers steps itself', () => {
  const steps = loadSteps('visualGuideSteps');
  assert.equal(steps.some((step) => step.target === 'shelf'), false);
  assert.match(guideScript, /String\(visualGuideStep \+ 1\)\.padStart\(2, '0'\)/);
  assert.match(guideScript, /visualGuideSteps\.filter\(function \(step\) \{ return !step\.home \|\| onHome; \}\)/);
});
