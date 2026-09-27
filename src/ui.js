/*
  The top of the screen, centred: the logo and the settings on one line, and under them the play
  controls — a large PLAY / STOP and ORBIT / TOUCH. The tempo lives in the timeline's header.
  The settings, in three blocks:

    LOOK    painted or dark, colour profile, texture set, shader style
    MOTION  touch zone, force, spin, return, marks thrown
    BLOCK   caves, a new block (its seed is in the tooltip and the URL), the timeline

  Kept compact the way SQNCR's panel is: a setting with a few named values is one word that
  cycles when clicked; a setting with levels is a short row of cells — click a cell to set it.
  Keyboard shortcuts sit behind `?`. Rebuilt from state on every change; it is a few dozen
  elements.
*/

const KEYS = [
  ['SPACE', 'play / stop'],
  ['B', 'tempo'],
  ['T', 'orbit / touch'],
  ['R', 'new rhythm'],
  ['H', 'hum a melody'],
  ['V', 'painted / dark'],
  ['P', 'colour profile'],
  ['X', 'texture set'],
  ['S', 'shader style'],
  ['G', 'new block'],
  ['L', 'timeline'],
  ['?', 'these keys'],
];

const LOGO_DRIFT = 24; // seconds for the logo's gradient to cross once (it then comes back)

export function renderPanel(el, state, act, logoColors = []) {
  el.innerHTML = '';
  const block = (title) => {
    const b = document.createElement('div');
    b.className = 'block';
    const h = document.createElement('span');
    h.className = 'head';
    h.textContent = title;
    b.append(h);
    el.append(b);
    return b;
  };
  const word = (parent, text, onClick, { on = true, title, cls = '' } = {}) => {
    const s = document.createElement('span');
    s.textContent = text;
    s.className = `word ${on ? 'on' : 'off'} ${cls}`;
    if (title) s.title = title;
    if (onClick) s.addEventListener('click', onClick);
    parent.append(s);
    return s;
  };
  // A named switch: the name dim, the current value lit; click anywhere on it to cycle.
  const cycle = (parent, name, value, onClick, title) => {
    const box = document.createElement('span');
    box.className = 'ctl cycle';
    box.title = title;
    box.addEventListener('click', onClick);
    if (name) {
      const n = document.createElement('span');
      n.className = 'name';
      n.textContent = name;
      box.append(n);
    }
    const v = document.createElement('span');
    v.className = 'word on';
    v.textContent = value;
    box.append(v);
    parent.append(box);
  };
  // A level meter: one cell per level, lit up to the current one.
  const meter = (parent, name, key, from, to, title) => {
    const box = document.createElement('span');
    box.className = 'ctl';
    box.title = title;
    const n = document.createElement('span');
    n.className = 'name';
    n.textContent = name;
    const cells = document.createElement('span');
    cells.className = 'cells';
    for (let v = from; v <= to; v++) {
      const c = document.createElement('span');
      c.className = `cell${v <= state[key] ? ' lit' : ''}`;
      c.title = `${name} ${v}`;
      c.addEventListener('click', () => act.set(key, v));
      cells.append(c);
    }
    box.append(n, cells);
    parent.append(box);
  };

  /*
    The logo: a gradient through the current profile's colours, stretched so wide that only two
    or three of them are on the word at once, drifting slowly back and forth. The panel is
    rebuilt on every change, so the drift is set to where the clock says it is, not restarted.
  */
  const brand = document.createElement('span');
  brand.className = 'brand';
  brand.textContent = 'VOLUM3';
  if (logoColors.length) {
    const stops = [...logoColors, logoColors[0]];
    brand.style.backgroundImage = `linear-gradient(90deg, ${stops.join(', ')})`;
    brand.style.backgroundSize = `${Math.round(((stops.length - 1) / 1.6) * 100)}% 100%`;
    brand.style.animationDelay = `${-((performance.now() / 1000) % (LOGO_DRIFT * 2))}s`;
  }
  el.append(brand);

  const look = block('LOOK');
  cycle(look, '', state.look === 'dark' ? 'DARK' : 'PAINTED', () => act.setLook(state.look === 'dark' ? 'painted' : 'dark'), 'PAINTED, or DARK: grey until struck (V)');
  cycle(look, 'COLOUR', state.profileLabel, act.cycleProfile, 'Colour profile (P)');
  cycle(look, 'TEXTURE', state.textureLabel, act.cycleTexture, 'Texture set: what is printed on the cubes (X)');
  cycle(look, 'SHADER', state.shaderLabel, act.cycleShader, 'Shader style on the cubes and the indicator, strongest on the cubes thrown furthest (S)');

  const motion = block('MOTION');
  meter(motion, 'ZONE', 'zone', 0, 4, 'How wide a touch reaches (first cell = one cube)');
  meter(motion, 'FORCE', 'force', 1, 5, 'How far a struck cube flies');
  meter(motion, 'SPIN', 'spin', 0, 4, 'How much a struck cube turns (first cell = none)');
  meter(motion, 'RETURN', 'ret', 1, 5, 'How quickly cubes spring back');
  meter(motion, 'MARKS', 'grain', 1, 5, 'What a struck cube throws: dots only … every mark, furthest');

  const cube = block('BLOCK');
  meter(cube, 'CAVES', 'caves', 1, 3, 'How hollow the block is (rebuilds it)');
  word(cube, 'NEW', act.generate, { title: `A new block (G). This one is #${state.seed.toString(36).toUpperCase()}, kept in the URL` });
  word(cube, 'TIMELINE', act.toggleTimeline, { on: state.timeline, title: 'Show / hide the timeline (L)' });
  word(cube, '?', act.toggleKeys, { on: state.keys, title: 'Keyboard shortcuts' });
}

// The play controls, centred under the settings.
export function renderPlay(el, state, act) {
  el.innerHTML = '';
  const b = document.createElement('span');
  b.className = `play-btn${state.playing ? ' on' : ''}`;
  b.textContent = state.playing ? '■ STOP' : '▶ PLAY';
  b.title = 'Play / stop (Space)';
  b.addEventListener('click', act.togglePlay);
  const m = document.createElement('span');
  m.className = 'mode';
  m.textContent = state.mode === 'orbit' ? 'ORBIT' : 'TOUCH';
  m.title = 'ORBIT: the indicator plays the block. TOUCH: you do (T)';
  m.addEventListener('click', () => act.setMode(state.mode === 'orbit' ? 'touch' : 'orbit'));
  el.append(b, m);
}

export function renderHint(el, state, count) {
  el.innerHTML = '';
  if (!state.unlocked) {
    const s = document.createElement('div');
    s.textContent = 'CLICK ANYWHERE FOR SOUND';
    el.append(s);
  }
  if (!state.keys) return;
  const grid = document.createElement('div');
  grid.className = 'keys';
  for (const [k, what] of KEYS) {
    const a = document.createElement('span');
    a.className = 'key';
    a.textContent = k;
    const b = document.createElement('span');
    b.textContent = what;
    grid.append(a, b);
  }
  el.append(grid);
  const n = document.createElement('div');
  n.textContent =
    state.mode === 'touch'
      ? `${count} CUBES · HOLD THE POINTER ON THE BLOCK · DRAG TO SPIN`
      : `${count} CUBES · HOVER A CUBE TO TOUCH IT · DRAG TO LOOK`;
  el.append(n);
}
