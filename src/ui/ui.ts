// DOM interface: loading, menu, garage, events map, settings, pause, results and the driving HUD.
import './style.css';
import { Save, Settings } from '../core/save';
import { ACTIVITIES, ActivityDef, HALF, WORLD_SIZE, biomeAt } from '../world/layout';
import { RoadNetwork } from '../world/roads';
import { HeightField } from '../world/terrain';
import { CARS, CarSpec } from '../vehicle/specs';
import { KIND_COLOR, KIND_LABEL, Result } from '../game/activities';

export interface UIActions {
  drive(): void; openGarage(): void; selectCar(id: string): void; buyCar(id: string): void; previewCar(id: string): void; paint(color: number): void;
  resume(): void; restartEvent(): void; quitEvent(): void; toMenu(): void; travel(def: ActivityDef): void; settingsChanged(): void; resetSave(): void;
  sound(kind: 'hover' | 'select' | 'back' | 'deny'): void; retry(): void;
}
export type ScreenName = 'loading' | 'menu' | 'garage' | 'events' | 'settings' | 'pause' | 'results' | 'none';
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
export const fmtTime = (t: number) => { if (!isFinite(t)) return '--:--.--'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(2).padStart(5, '0')}`; };
const starStr = (n: number) => '★'.repeat(n) + '<i>' + '★'.repeat(3 - n) + '</i>';
const PAINTS = [0xd4380d, 0xf2b705, 0x0e2a4a, 0x4d5a3a, 0xe9e6df, 0x121316, 0x8a1020, 0x1f6f8b, 0x6b3fa0];
const TIPS = [
  'Tap SPACE into a corner to break traction, then steer and feed the throttle to hold the slide.',
  'The Bastion X keeps its grip on dirt and sand. Everything else is happier on tarmac.',
  'Press C to cycle chase, far chase, hood and cockpit cameras.',
  'Rain makes the tarmac slick. Brake earlier and be gentle with the throttle.',
  'Stuck or upside down? Press R to put the car back on the road.',
  'SHIFT fires the boost. It recharges on its own.',
];

export class UI {
  screen: ScreenName = 'loading';
  private prev: ScreenName = 'menu';
  private root = $('#ui');
  private mapCanvas = document.createElement('canvas');
  private mini!: HTMLCanvasElement; private miniCtx!: CanvasRenderingContext2D;
  private garageSel = 'coupe';
  private hintT = 0; private flashT = 0; private lastSpeed = -1; private lastGear = ''; private settingsBack: ScreenName = 'menu';
  private el: Record<string, HTMLElement> = {};

  constructor(private save: Save, private act: UIActions) {
    this.root.innerHTML = `
    <div id="loading" class="screen on">
      <div class="logo"><div class="a">HORIZON</div><div class="b">OPEN ROADS</div></div>
      <div class="bar"><i id="loadBar"></i></div><div id="loadLabel">Starting engines</div>
      <div id="loadTip">${TIPS[Math.floor(Math.random() * TIPS.length)]}</div>
    </div>
    <div id="menu" class="screen">
      <div class="left">
        <div class="logo"><div class="a">HORIZON</div><div class="b">OPEN ROADS</div></div>
        <div>
          <div class="nav">
            <button class="primary" data-a="drive">Drive</button><button data-a="garage">Garage</button><button data-a="events">Events &amp; Map</button><button data-a="settings">Settings</button>
          </div>
        </div>
        <div class="statline"><div>Level<b id="mLevel">1</b></div><div>Credits<b id="mCredits">0</b></div><div>Stars<b id="mStars">0</b></div><div>Driven<b id="mDist">0 km</b></div></div>
      </div>
      <div class="right">Desert · Mountain · Forest<br/>12.7 km loop · 4 cars · 11 events</div>
    </div>
    <div id="garage" class="screen">
      <div class="carlist"><div class="eyebrow">Garage</div><h2>Choose your car</h2><div id="carCards" style="display:flex;flex-direction:column;gap:10px"></div>
        <div class="wallet" style="margin-top:auto">Credits <b id="gCredits">0</b></div></div>
      <div class="carinfo">
        <div><div class="eyebrow" id="gClass"></div><h2 id="gName"></h2><p id="gTag"></p></div>
        <div id="gStats" style="display:flex;flex-direction:column;gap:9px"></div>
        <div class="specs" id="gSpecs"></div>
        <div><div class="eyebrow" style="margin-bottom:8px">Paint</div><div class="swatches" id="gPaint"></div></div>
        <div class="row"><button class="btn" data-a="back">Back</button><button class="btn go" id="gAction" style="flex:1">Drive</button></div>
      </div>
    </div>
    <div id="events" class="screen dimmed"><div class="sheet">
      <header><div><div class="eyebrow">World</div><h2>Events &amp; Map</h2></div><div class="wallet">Stars <b id="eStars">0</b> / 33</div></header>
      <div class="body evgrid"><canvas id="bigmap" width="720" height="720"></canvas><div class="evlist" id="evList"></div></div>
      <footer><div class="note" style="margin-right:auto">Select an event to fast travel to its start line.</div><button class="btn" data-a="back">Back</button></footer>
    </div></div>
    <div id="settings" class="screen dimmed"><div class="sheet" style="width:min(820px,94vw)">
      <header><div><div class="eyebrow">Options</div><h2>Settings</h2></div></header>
      <div class="body setgrid" id="setBody"></div>
      <footer><button class="btn" id="resetSave" style="margin-right:auto">Reset progress</button><button class="btn go" data-a="back">Done</button></footer>
    </div></div>
    <div id="pause" class="screen">
      <div><div class="eyebrow">Paused</div><h2 id="pTitle">Free Roam</h2>
        <div class="nav"><button class="primary" data-a="resume">Resume</button><button data-a="restart" id="pRestart">Restart event</button><button data-a="quitEvent" id="pQuit">Quit event</button>
          <button data-a="events">Events &amp; Map</button><button data-a="garage">Garage</button><button data-a="settings">Settings</button><button data-a="menu">Main menu</button></div></div>
      <div class="controls"><h3>Controls</h3>
        <span><span class="kbd">W</span> <span class="kbd">A</span> <span class="kbd">S</span> <span class="kbd">D</span> / arrows</span><span>Accelerate, steer, brake / reverse</span>
        <span><span class="kbd">Space</span></span><span>Handbrake</span><span><span class="kbd">Shift</span></span><span>Boost</span>
        <span><span class="kbd">C</span></span><span>Change camera</span><span><span class="kbd">R</span></span><span>Reset to road</span>
        <span><span class="kbd">Enter</span></span><span>Start event at a start gate</span><span><span class="kbd">M</span></span><span>Events &amp; map</span>
        <span><span class="kbd">T</span></span><span>Skip time forward</span><span><span class="kbd">Esc</span></span><span>Pause</span></div>
    </div>
    <div id="results" class="screen"><div class="res">
      <div class="eyebrow" id="rKind"></div><h2 id="rName"></h2><div class="big" id="rValue"></div><div class="stars" id="rStars"></div><div class="pb" id="rPb"></div>
      <div class="targets" id="rTargets"></div>
      <div class="rew"><div>Credits<b id="rCr"></b></div><div>XP<b id="rXp"></b></div><div>Best<b id="rBest"></b></div></div>
      <div class="row" style="justify-content:center"><button class="btn" data-a="retry">Retry</button><button class="btn go" data-a="resume">Continue</button></div>
    </div></div>
    <div id="hud">
      <div class="topleft"><div class="lvl" id="hLevel">1</div><div>Credits<b id="hCredits">0</b></div><div>Stars<b id="hStars">0</b></div></div>
      <div class="topright"><span id="hWeather">Clear</span><b id="hClock">16:30</b></div>
      <div id="actpanel"><div class="name" id="aName"></div><div class="timer" id="aTimer">0:00.00</div><div class="sub" id="aSub"></div><div class="prog"><i id="aProg"></i></div></div>
      <div id="drift"><div class="k" id="dName">Drift zone</div><div class="v" id="dScore">0</div><div class="k" id="dCombo">x1.0</div></div>
      <div id="toasts"></div><div id="count"></div><div id="warn">Press R to return to the route</div><div id="flash"></div>
      <div id="prompt"><div class="eyebrow" id="prKind"></div><div class="t" id="prName"></div><div class="d" id="prDesc"></div><div class="a"><span class="kbd">Enter</span> Start event &nbsp; <span id="prBest"></span></div></div>
      <canvas id="minimap" width="210" height="210"></canvas>
      <div class="place"><span id="hBiome">Desert</span><b id="hRoad">Horizon Loop</b></div>
      <div id="hint"><span><span class="kbd">W A S D</span> Drive</span><span><span class="kbd">Space</span> Handbrake</span><span><span class="kbd">Shift</span> Boost</span><span><span class="kbd">C</span> Camera</span><span><span class="kbd">R</span> Reset</span><span><span class="kbd">Esc</span> Pause</span></div>
      <div class="cluster">
        <svg viewBox="0 0 300 230"><path id="rpmBg" d="" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="9"/><path id="rpmRed" d="" fill="none" stroke="rgba(255,60,40,0.75)" stroke-width="9"/><path id="rpmArc" d="" fill="none" stroke="#f3f1ec" stroke-width="9"/><g id="rpmTicks"></g></svg>
        <div class="gear" id="hGear">1</div><div class="speed" id="hSpeed">0</div><div class="unit" id="hUnit">KM/H</div><div class="nlabel">Boost</div><div class="nitro"><i id="hNitro"></i></div>
      </div>
    </div>`;
    for (const id of ['loadBar', 'loadLabel', 'mLevel', 'mCredits', 'mStars', 'mDist', 'gCredits', 'gClass', 'gName', 'gTag', 'gStats', 'gSpecs', 'gPaint', 'gAction', 'carCards', 'evList', 'eStars', 'setBody',
      'pTitle', 'pRestart', 'pQuit', 'rKind', 'rName', 'rValue', 'rStars', 'rPb', 'rTargets', 'rCr', 'rXp', 'rBest', 'hud', 'hLevel', 'hCredits', 'hStars', 'hWeather', 'hClock', 'actpanel', 'aName', 'aTimer', 'aSub', 'aProg',
      'drift', 'dName', 'dScore', 'dCombo', 'toasts', 'count', 'warn', 'flash', 'prompt', 'prKind', 'prName', 'prDesc', 'prBest', 'hBiome', 'hRoad', 'hint', 'rpmBg', 'rpmRed', 'rpmArc', 'rpmTicks', 'hGear', 'hSpeed', 'hUnit', 'hNitro']) this.el[id] = $('#' + id);
    this.mini = $<HTMLCanvasElement>('#minimap'); this.miniCtx = this.mini.getContext('2d')!;
    this.root.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null; if (!b) return;
      const a = b.dataset.a!;
      if (a === 'back') { act.sound('back'); this.back(); return; }
      act.sound('select');
      if (a === 'drive') act.drive(); else if (a === 'garage') act.openGarage(); else if (a === 'events') this.show('events'); else if (a === 'settings') this.show('settings');
      else if (a === 'resume') act.resume(); else if (a === 'restart') act.restartEvent(); else if (a === 'quitEvent') act.quitEvent(); else if (a === 'menu') act.toMenu(); else if (a === 'retry') act.retry();
    });
    this.root.addEventListener('mouseover', e => { const t = e.target as HTMLElement; if (t.tagName === 'BUTTON' && !(e.relatedTarget && t.contains(e.relatedTarget as Node))) act.sound('hover'); });
    this.el.gAction.addEventListener('click', () => {
      const owned = this.save.data.owned.includes(this.garageSel), spec = CARS.find(c => c.id === this.garageSel)!;
      if (owned) { act.sound('select'); act.selectCar(this.garageSel); }
      else if (this.save.data.credits >= spec.price) { act.buyCar(this.garageSel); this.renderGarage(); } else act.sound('deny');
    });
    $('#resetSave').addEventListener('click', () => { if (confirm('Reset all progress, unlocked cars and best times?')) act.resetSave(); });
    this.drawGauge(8000, 7000);
  }

  setProgress(f: number, label: string) { this.el.loadBar.style.width = Math.round(f * 100) + '%'; this.el.loadLabel.textContent = label; }
  show(name: ScreenName) {
    if (name === 'settings') this.settingsBack = this.screen === 'settings' ? this.settingsBack : this.screen;
    if (name === 'events' || name === 'garage') this.prev = this.screen === 'pause' || this.screen === 'menu' ? this.screen : this.prev;
    if (name === 'events') this.renderEvents(); if (name === 'settings') this.renderSettings(); if (name === 'garage') { this.garageSel = this.save.data.car; this.renderGarage(); } if (name === 'menu') this.renderMenu();
    for (const s of ['menu', 'garage', 'events', 'settings', 'pause', 'results']) $('#' + s).classList.toggle('on', s === name);
    if (name !== 'loading') { const l = $('#loading'); l.classList.add('fade'); setTimeout(() => l.classList.remove('on'), 800); }
    this.el.hud.classList.toggle('on', name === 'none');
    if (name === 'none') { this.hintT = 14; this.el.hint.classList.remove('hide'); }
    this.screen = name;
  }
  back() { if (this.screen === 'settings') this.show(this.settingsBack); else if (this.screen === 'garage') this.act.toMenu(); else this.show(this.prev); }
  get garageCar() { return this.garageSel; }

  private renderMenu() {
    const d = this.save.data;
    this.el.mLevel.textContent = String(this.save.level); this.el.mCredits.textContent = d.credits.toLocaleString(); this.el.mStars.textContent = `${this.save.totalStars}`; this.el.mDist.textContent = (d.distance / 1000).toFixed(1) + ' km';
  }
  renderGarage() {
    const d = this.save.data;
    this.el.gCredits.textContent = d.credits.toLocaleString();
    this.el.carCards.innerHTML = CARS.map(c => `<button class="carcard ${c.id === this.garageSel ? 'sel' : ''}" data-car="${c.id}"><div class="k">${c.klass}</div><div class="n">${c.name}</div><div class="tag">${d.owned.includes(c.id) ? (d.car === c.id ? 'Current' : 'Owned') : c.price.toLocaleString() + ' CR'}</div></button>`).join('');
    this.el.carCards.querySelectorAll<HTMLElement>('[data-car]').forEach(b => b.onclick = () => { this.garageSel = b.dataset.car!; this.act.sound('select'); this.act.previewCar(this.garageSel); this.renderGarage(); });
    const c = CARS.find(x => x.id === this.garageSel) as CarSpec, owned = d.owned.includes(c.id);
    this.el.gClass.textContent = c.klass; this.el.gName.textContent = c.name; this.el.gTag.textContent = c.tagline;
    const st: [string, number][] = [['Speed', c.stats.speed], ['Acceleration', c.stats.accel], ['Handling', c.stats.handling], ['Off-road', c.stats.offroad]];
    this.el.gStats.innerHTML = st.map(s => `<div class="stat"><span>${s[0]}</span><div class="track"><i style="width:${s[1] * 10}%"></i></div><b>${s[1].toFixed(1)}</b></div>`).join('');
    const mph = d.settings.units === 'mph';
    this.el.gSpecs.innerHTML = `<div>Top speed<b>${Math.round(c.topKmh * (mph ? 0.6214 : 1))} ${mph ? 'mph' : 'km/h'}</b></div><div>Drive<b>${c.drive.toUpperCase()}</b></div><div>Weight<b>${c.mass} kg</b></div>`;
    this.el.gPaint.innerHTML = PAINTS.map(p => `<button style="background:${hex(p)}" data-paint="${p}" aria-label="Paint ${hex(p)}"></button>`).join('');
    this.el.gPaint.querySelectorAll<HTMLElement>('[data-paint]').forEach(b => b.onclick = () => { this.act.sound('select'); this.act.paint(Number(b.dataset.paint)); });
    const btn = this.el.gAction as HTMLButtonElement;
    btn.textContent = owned ? 'Drive this car' : `Buy for ${c.price.toLocaleString()} CR`; btn.disabled = !owned && d.credits < c.price;
    if (!owned && d.credits < c.price) btn.textContent = `Need ${(c.price - d.credits).toLocaleString()} more CR`;
  }
  private renderEvents() {
    const d = this.save.data; this.el.eStars.textContent = String(this.save.totalStars);
    this.el.evList.innerHTML = ACTIVITIES.map(a => {
      const r = d.activities[a.id], timed = a.kind === 'race' || a.kind === 'trial';
      const best = r && r.best != null && isFinite(r.best) && r.best > 0 ? (timed ? fmtTime(r.best) : a.kind === 'trap' ? this.speedStr(r.best) : Math.round(r.best).toLocaleString() + ' pts') : 'Not set';
      return `<button class="ev" data-ev="${a.id}"><span class="dot" style="background:${hex(KIND_COLOR[a.kind])}"></span><span><div class="t">${a.name}</div><div class="s">${KIND_LABEL[a.kind]} · ${a.biome}</div></span><span class="r"><div class="stars">${starStr(r ? r.stars : 0)}</div>${best}</span></button>`;
    }).join('');
    this.el.evList.querySelectorAll<HTMLElement>('[data-ev]').forEach(b => b.onclick = () => { this.act.sound('select'); this.act.travel(ACTIVITIES.find(a => a.id === b.dataset.ev)!); });
    this.drawBigMap();
  }
  private renderSettings() {
    const s = this.save.data.settings;
    const seg = (key: keyof Settings, label: string, opts: [string, string][], note = '') => `<div class="set"><label>${label}</label><div class="seg">${opts.map(o => `<button data-set="${key}" data-val="${o[0]}" class="${String(s[key]) === o[0] ? 'on' : ''}">${o[1]}</button>`).join('')}</div>${note ? `<div class="note">${note}</div>` : ''}</div>`;
    const rng = (key: keyof Settings, label: string) => `<div class="set"><label>${label}</label><input type="range" min="0" max="1" step="0.05" value="${s[key]}" data-rng="${key}" /></div>`;
    this.el.setBody.innerHTML = seg('quality', 'Graphics quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], 'Low suits integrated graphics. Resolution also adapts automatically to hold frame rate.')
      + seg('units', 'Speed units', [['kmh', 'km/h'], ['mph', 'mph']])
      + seg('weather', 'Weather', [['dynamic', 'Dynamic'], ['clear', 'Clear'], ['rain', 'Rain']])
      + seg('timeFlow', 'Time of day', [['cycle', 'Cycle'], ['day', 'Noon'], ['sunset', 'Sunset'], ['night', 'Night']])
      + rng('master', 'Master volume') + rng('engine', 'Car & effects volume') + rng('ambience', 'Ambience volume')
      + seg('camShake', 'Camera shake', [['true', 'On'], ['false', 'Off']]);
    this.el.setBody.querySelectorAll<HTMLElement>('[data-set]').forEach(b => b.onclick = () => {
      const k = b.dataset.set as keyof Settings, v = b.dataset.val!;
      (s as any)[k] = k === 'camShake' ? v === 'true' : v; this.save.write(); this.act.sound('select'); this.act.settingsChanged(); this.renderSettings();
    });
    this.el.setBody.querySelectorAll<HTMLInputElement>('[data-rng]').forEach(i => i.oninput = () => { (s as any)[i.dataset.rng!] = Number(i.value); this.save.write(); this.act.settingsChanged(); });
  }
  showPause(activeName: string | null) {
    this.el.pTitle.textContent = activeName ?? 'Free Roam';
    this.el.pRestart.style.display = this.el.pQuit.style.display = activeName ? '' : 'none';
    this.show('pause');
  }
  speedStr(kmh: number) { const mph = this.save.data.settings.units === 'mph'; return `${Math.round(kmh * (mph ? 0.6214 : 1))} ${mph ? 'mph' : 'km/h'}`; }
  showResult(r: Result) {
    const timed = r.def.kind === 'race' || r.def.kind === 'trial';
    this.el.rKind.textContent = `${KIND_LABEL[r.def.kind]} · ${r.def.biome}`; this.el.rName.textContent = r.def.name;
    this.el.rValue.textContent = timed ? fmtTime(r.value) : String(Math.round(r.value));
    this.el.rStars.innerHTML = starStr(r.stars); this.el.rPb.textContent = r.newBest ? 'New personal best' : '';
    this.el.rTargets.innerHTML = `★ ${fmtTime(r.def.stars[0])} &nbsp;·&nbsp; ★★ ${fmtTime(r.def.stars[1])} &nbsp;·&nbsp; ★★★ ${fmtTime(r.def.stars[2])}`;
    this.el.rCr.textContent = '+' + r.credits.toLocaleString(); this.el.rXp.textContent = '+' + r.xp; this.el.rBest.textContent = fmtTime(r.best);
    this.show('results');
  }
  toast(kind: string, title: string, value: string, stars: number, sub: string) {
    const t = document.createElement('div'); t.className = 'toast'; t.style.borderTopColor = hex(KIND_COLOR[kind] ?? 0xff7a1a);
    if (kind === 'trap') { value = this.speedStr(Number(value)); if (sub.startsWith('best:')) sub = 'Best ' + this.speedStr(Number(sub.slice(5))); }
    t.innerHTML = `<div class="k">${KIND_LABEL[kind] ?? kind} · ${title}</div><div class="v">${value}</div>${stars >= 0 ? `<div class="stars">${starStr(stars)}</div>` : ''}<div class="s">${sub}</div>`;
    this.el.toasts.appendChild(t); setTimeout(() => t.remove(), 4200);
    while (this.el.toasts.children.length > 2) this.el.toasts.firstChild!.remove();
  }
  note(title: string, sub: string) {
    const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = `<div class="k">${title}</div><div class="s" style="font-size:15px;color:var(--ink);margin-top:4px">${sub}</div>`;
    this.el.toasts.appendChild(t); setTimeout(() => t.remove(), 4200);
  }
  countdown(n: number) { const c = this.el.count; c.textContent = n > 0 ? String(n) : 'GO'; c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop'); }
  flash(text: string) { this.el.flash.textContent = text; this.el.flash.classList.add('on'); this.flashT = 1.6; }
  setPrompt(def: ActivityDef | null) {
    this.el.prompt.classList.toggle('on', !!def); if (!def) return;
    if (this.el.prName.textContent === def.name) return;
    const r = this.save.data.activities[def.id];
    this.el.prKind.textContent = `${KIND_LABEL[def.kind]} · ${def.biome}`; this.el.prName.textContent = def.name; this.el.prDesc.textContent = def.blurb;
    this.el.prBest.innerHTML = r && r.best != null && isFinite(r.best) ? `Best ${fmtTime(r.best)} <span class="stars">${starStr(r.stars)}</span>` : `Gold target ${fmtTime(def.stars[2])}`;
  }

  // ---------------- gauge
  private arc(a0: number, a1: number, r = 104) {
    const cx = 150, cy = 124, p = (a: number) => `${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)}`;
    return `M ${p(a0)} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)}`;
  }
  private A0 = Math.PI * 0.78; private A1 = Math.PI * 2.02; private redFrac = 0.88;
  drawGauge(redline: number, shift: number) {
    this.redFrac = shift / redline;
    this.el.rpmBg.setAttribute('d', this.arc(this.A0, this.A1)); this.el.rpmRed.setAttribute('d', this.arc(this.A0 + (this.A1 - this.A0) * this.redFrac, this.A1));
    let t = ''; const n = Math.round(redline / 1000);
    for (let i = 0; i <= n; i++) { const a = this.A0 + (this.A1 - this.A0) * (i * 1000 / redline), c = Math.cos(a), s = Math.sin(a); t += `<line x1="${150 + c * 90}" y1="${124 + s * 90}" x2="${150 + c * 97}" y2="${124 + s * 97}" stroke="rgba(255,255,255,.5)" stroke-width="2"/><text x="${150 + c * 78}" y="${128 + s * 78}" fill="rgba(255,255,255,.55)" font-size="11" text-anchor="middle">${i}</text>`; }
    this.el.rpmTicks.innerHTML = t;
  }

  updateHud(dt: number, h: { kmh: number; rpm: number; redline: number; gear: number; nitro: number; boosting: boolean; clock: string; weather: string; biome: string; road: string }) {
    const mph = this.save.data.settings.units === 'mph', sp = Math.round(h.kmh * (mph ? 0.6214 : 1));
    if (sp !== this.lastSpeed) { this.el.hSpeed.textContent = String(sp); this.lastSpeed = sp; }
    const g = h.gear < 0 ? 'R' : String(h.gear); if (g !== this.lastGear) { this.el.hGear.textContent = g; this.lastGear = g; this.el.hUnit.textContent = mph ? 'MPH' : 'KM/H'; }
    const f = Math.min(1, h.rpm / h.redline);
    this.el.rpmArc.setAttribute('d', this.arc(this.A0, this.A0 + (this.A1 - this.A0) * Math.max(0.01, f)));
    this.el.rpmArc.setAttribute('stroke', f > this.redFrac ? '#ff5a3c' : '#f3f1ec');
    this.el.hNitro.style.width = (h.nitro * 100).toFixed(0) + '%'; this.el.hNitro.style.filter = h.boosting ? 'brightness(1.6)' : '';
    this.el.hClock.textContent = h.clock; this.el.hWeather.textContent = h.weather; this.el.hBiome.textContent = h.biome; this.el.hRoad.textContent = h.road;
    if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) this.el.hint.classList.add('hide'); }
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.el.flash.classList.remove('on'); }
  }
  updateWallet() { this.el.hLevel.textContent = String(this.save.level); this.el.hCredits.textContent = this.save.data.credits.toLocaleString(); this.el.hStars.textContent = String(this.save.totalStars); }
  setActivity(a: { name: string; time: number; sub: string; progress: number } | null) {
    this.el.actpanel.classList.toggle('on', !!a); if (!a) return;
    this.el.aName.textContent = a.name; this.el.aTimer.textContent = fmtTime(a.time); this.el.aSub.textContent = a.sub; this.el.aProg.style.width = (a.progress * 100).toFixed(1) + '%';
  }
  setDrift(d: { name: string; score: number; combo: number } | null) {
    this.el.drift.classList.toggle('on', !!d); if (!d) return;
    this.el.dName.textContent = 'Drift zone · ' + d.name; this.el.dScore.textContent = Math.round(d.score).toLocaleString(); this.el.dCombo.textContent = 'x' + d.combo.toFixed(1);
  }
  setWarn(on: boolean) { this.el.warn.classList.toggle('on', on); }

  // ---------------- maps
  private MS = 1024;
  private w2m = (v: number) => (v + HALF) / WORLD_SIZE * this.MS;
  buildMap(net: RoadNetwork, hf: HeightField) {
    const S = this.MS, c = this.mapCanvas; c.width = c.height = S; const g = c.getContext('2d')!;
    const img = g.createImageData(256, 256), b: [number, number, number] = [0, 0, 0];
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const wx = (x + 0.5) / 256 * WORLD_SIZE - HALF, wz = (y + 0.5) / 256 * WORLD_SIZE - HALF;
      biomeAt(wx, wz, b); const h = hf.sample(wx, wz), sh = 0.72 + Math.min(0.5, (hf.sample(wx - 14, wz - 14) - h) * 0.02 + 0.14);
      const r = (58 * b[0] + 40 * b[1] + 20 * b[2]) * sh, gg = (44 * b[0] + 44 * b[1] + 38 * b[2]) * sh, bb = (32 * b[0] + 50 * b[1] + 26 * b[2]) * sh;
      const k = (y * 256 + x) * 4, wat = hf.inWater(wx, wz) && wx > 0;
      img.data[k] = wat ? 24 : r; img.data[k + 1] = wat ? 60 : gg; img.data[k + 2] = wat ? 78 : bb; img.data[k + 3] = 255;
    }
    const tmp = document.createElement('canvas'); tmp.width = tmp.height = 256; tmp.getContext('2d')!.putImageData(img, 0, 0);
    g.imageSmoothingQuality = 'high'; g.drawImage(tmp, 0, 0, S, S);
    for (const pass of [0, 1]) for (const r of net.roads) {
      g.beginPath();
      for (let i = 0; i <= r.n; i += 3) { const j = r.wrapClamp(i); const x = this.w2m(r.px[j]), y = this.w2m(r.pz[j]); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); }
      g.lineJoin = g.lineCap = 'round';
      g.strokeStyle = pass === 0 ? 'rgba(0,0,0,0.55)' : r.def.surface === 'asphalt' ? '#f1efe9' : '#c9a36b'; g.lineWidth = pass === 0 ? 9 : r.def.surface === 'asphalt' ? 4.5 : 3.2; g.stroke();
    }
  }
  private pin(g: CanvasRenderingContext2D, x: number, y: number, color: string, r: number) { g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fillStyle = color; g.fill(); g.lineWidth = 2; g.strokeStyle = '#0c0e12'; g.stroke(); }
  private markers: { x: number; z: number; color: string }[] = [];
  setMarkers(m: { x: number; z: number; color: string }[]) { this.markers = m; }
  player = { x: 0, z: 0, yaw: 0 }; target: { x: number; z: number } | null = null;
  drawMinimap() {
    const g = this.miniCtx, W = 210, zoom = 0.62; // px per map px
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, W);
    g.save(); g.beginPath(); g.arc(W / 2, W / 2, W / 2, 0, 6.283); g.clip();
    g.translate(W / 2, W / 2 + 28); g.rotate(this.player.yaw); g.scale(zoom, zoom);
    const px = this.w2m(this.player.x), pz = this.w2m(this.player.z);
    g.drawImage(this.mapCanvas, -px, -pz);
    for (const m of this.markers) this.pin(g, this.w2m(m.x) - px, this.w2m(m.z) - pz, m.color, 7);
    if (this.target) { this.pin(g, this.w2m(this.target.x) - px, this.w2m(this.target.z) - pz, '#ffc23d', 11); }
    g.restore();
    g.save(); g.translate(W / 2, W / 2 + 28); g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath(); g.fillStyle = '#fff'; g.strokeStyle = '#0c0e12'; g.lineWidth = 2; g.fill(); g.stroke(); g.restore();
  }
  private drawBigMap() {
    const c = $<HTMLCanvasElement>('#bigmap'), g = c.getContext('2d')!, k = c.width / this.MS;
    g.setTransform(k, 0, 0, k, 0, 0); g.drawImage(this.mapCanvas, 0, 0);
    for (const m of this.markers) this.pin(g, this.w2m(m.x), this.w2m(m.z), m.color, 11);
    g.save(); g.translate(this.w2m(this.player.x), this.w2m(this.player.z)); g.rotate(-this.player.yaw); g.scale(1.6, 1.6);
    g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath(); g.fillStyle = '#fff'; g.strokeStyle = '#0c0e12'; g.lineWidth = 2; g.fill(); g.stroke(); g.restore();
    g.font = '600 22px Bahnschrift, Segoe UI, sans-serif'; g.fillStyle = 'rgba(255,255,255,0.5)'; g.textAlign = 'center';
    g.fillText('DESERT', this.w2m(-900), this.w2m(950)); g.fillText('MOUNTAIN', this.w2m(-200), this.w2m(-1820)); g.fillText('FOREST', this.w2m(1150), this.w2m(820));
  }
}
