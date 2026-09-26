/*
  The panel is words, like SQNCR's: a dim name, then the values as clickable words, the current
  one lit. Rebuilt from state on every change — there are a dozen elements, it costs nothing.
*/

const BPMS = [60, 80, 100, 120, 140];

export function renderPanel(el, state, act) {
  el.innerHTML = '';
  let row = null;
  const newRow = () => {
    row = document.createElement('div');
    row.className = 'row';
    el.append(row);
  };
  const ctl = (name, words, title) => {
    const box = document.createElement('span');
    box.className = 'ctl';
    if (title) box.title = title;
    if (name) {
      const n = document.createElement('span');
      n.className = 'name';
      n.textContent = name;
      box.append(n);
    }
    for (const w of words) {
      const s = document.createElement('span');
      s.textContent = w.text;
      s.className = w.brand ? 'brand' : `word ${w.on === undefined ? 'on' : w.on ? 'on' : 'off'}`;
      if (w.onClick) s.addEventListener('click', w.onClick);
      box.append(s);
    }
    row.append(box);
  };
  const levels = (key, from, to) => {
    const out = [];
    for (let v = from; v <= to; v++) out.push({ text: String(v), on: state[key] === v, onClick: () => act.set(key, v) });
    return out;
  };

  newRow();
  ctl(null, [{ text: 'VOLUM3', brand: true }]);
  ctl(null, [{ text: state.playing ? 'STOP' : 'PLAY', onClick: act.togglePlay }]);
  ctl('MODE', [
    { text: 'ORBIT', on: state.mode === 'orbit', onClick: () => act.setMode('orbit') },
    { text: 'TOUCH', on: state.mode === 'touch', onClick: () => act.setMode('touch') },
  ]);
  ctl(null, [{ text: 'GENERATE', onClick: act.generate }]);
  ctl('BPM', BPMS.map((b) => ({ text: String(b), on: state.bpm === b, onClick: () => act.setBpm(b) })));
  ctl('EMISSION', [1, 2, 3, 4, 5].map((g) => ({ text: String(g), on: state.grain === g, onClick: () => act.setGrain(g) })));
  ctl('SEED', [{ text: state.seed.toString(36).toUpperCase(), on: true }]);

  newRow();
  ctl('ZONE', levels('zone', 0, 4), 'How wide a touch reaches. 0 = just the cube under the pointer');
  ctl('FORCE', levels('force', 1, 5), 'How far a struck cube flies');
  ctl('SPIN', levels('spin', 0, 4), 'How much a struck cube turns in space');
  ctl('RETURN', levels('ret', 1, 5), 'How quickly cubes spring back. 1 = slow and floaty, 5 = tight');
  ctl('CAVES', levels('caves', 1, 3), 'How hollow the block is. Rebuilds it');
}

export function renderHint(el, state, count) {
  const sound = state.unlocked ? '' : 'CLICK FOR SOUND · ';
  const how =
    state.mode === 'orbit'
      ? 'SPACE PLAY · T TOUCH MODE · G GENERATE · HOVER A CUBE TO TOUCH IT · DRAG TO LOOK AROUND'
      : 'HOVER TO TOUCH · DRAG TO SPIN · T ORBIT MODE · G GENERATE';
  el.textContent = `${sound}${how} · ${count} CUBES`;
}
