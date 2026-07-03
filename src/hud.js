// DOM HUD: menus, crosshair, health, ammo, hitmarkers, damage numbers, match
// UI (timer/scores/kill feed/scoreboard), overlays. Reads sim/net state
// passively; reacts to events via explicit calls from main.

import { WEAPONS } from './sim/weapons.js';

const WEAPON_META = {
  ar: { type: 'Assault Rifle', dmg: 0.55, rate: 0.75, range: 0.65 },
  dmr: { type: 'Marksman Rifle', dmg: 1.0, rate: 0.3, range: 1.0 },
  smg: { type: 'Submachine Gun', dmg: 0.3, rate: 1.0, range: 0.4 },
};

export class Hud {
  constructor() {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="hud">
        <div id="damage-vignette"></div>
        <div id="scope-overlay" class="hidden"><div class="ring"></div><div class="cross-h"></div><div class="cross-v"></div></div>
        <div id="crosshair">
          <div class="l h left"></div><div class="l h right"></div>
          <div class="l v up"></div><div class="l v down"></div>
          <div class="dot"></div>
        </div>
        <div id="hitmarker">
          <div class="m m1"></div><div class="m m2"></div>
          <div class="m m3"></div><div class="m m4"></div>
        </div>
        <div id="fps"></div>
        <div id="match-top" class="hidden">
          <span id="score-red">0</span>
          <span id="match-timer">10:00</span>
          <span id="score-blue">0</span>
        </div>
        <div id="room-tag" class="hidden">ROOM <b id="room-code-tag"></b></div>
        <div id="score"></div>
        <div id="killfeed"></div>
        <div id="health-wrap">
          <div id="health-num">100</div>
          <div id="health-bar-bg"><div id="health-bar"></div></div>
        </div>
        <div id="ammo">
          <div><span class="mag">30</span> <span class="reserve">/ 120</span></div>
          <div class="wname"></div>
        </div>
        <div id="scoreboard" class="hidden">
          <div class="sb-title">SCOREBOARD — <span id="sb-scores"></span></div>
          <div class="sb-cols">
            <div class="sb-team" id="sb-red"><h3>RED</h3></div>
            <div class="sb-team" id="sb-blue"><h3>BLUE</h3></div>
          </div>
          <div class="sb-foot" id="sb-foot"></div>
        </div>
      </div>

      <div id="menu-overlay" class="overlay">
        <h1>DEP<span class="accent">O</span>T</h1>
        <div class="sub">BROWSER ARENA — PICK A MODE</div>
        <div class="modes">
          <button class="mode-btn" id="btn-bots">PLAY WITH BOTS<span>solo warm-up against 5 bots</span></button>
          <button class="mode-btn" id="btn-friends">PLAY WITH FRIENDS<span>6v6 team rooms with a share code</span></button>
        </div>
      </div>

      <div id="friends-overlay" class="overlay hidden">
        <h1>PLAY WITH <span class="accent">FRIENDS</span></h1>
        <div class="sub">TEAM DEATHMATCH — 6 VS 6 — 10 MINUTES</div>
        <div class="friends-box">
          <label>YOUR NAME</label>
          <input id="name-input" maxlength="14" placeholder="PLAYER" autocomplete="off">
          <div class="friends-row">
            <button class="big-btn" id="btn-create">CREATE ROOM</button>
            <div class="or">or</div>
            <div class="join-group">
              <input id="code-input" maxlength="5" placeholder="CODE" autocomplete="off">
              <button class="big-btn" id="btn-join">JOIN ROOM</button>
            </div>
          </div>
          <div id="friends-status"></div>
          <button class="back-btn" id="btn-back">&larr; BACK</button>
        </div>
      </div>

      <div id="loadout-overlay" class="overlay hidden">
        <div class="died hidden" id="died-line">YOU WERE DROPPED</div>
        <div class="room-line hidden" id="room-line">ROOM CODE <b id="room-code"></b> — SHARE IT WITH FRIENDS — TEAM <b id="team-name"></b></div>
        <h1>DEP<span class="accent">O</span>T</h1>
        <div class="sub">PICK YOUR WEAPON</div>
        <div class="cards" id="cards"></div>
        <div class="hint">WASD move &nbsp;·&nbsp; SHIFT sprint &nbsp;·&nbsp; C crouch &nbsp;·&nbsp; SPACE jump<br>
        LMB fire &nbsp;·&nbsp; RMB scope &nbsp;·&nbsp; R reload &nbsp;·&nbsp; TAB scoreboard</div>
      </div>

      <div id="resume-overlay" class="overlay hidden">
        <h1>PAUSED</h1>
        <div class="sub">CLICK TO RESUME</div>
      </div>
    `);

    const $ = (id) => document.getElementById(id);
    this.el = {
      hud: $('hud'),
      crosshair: $('crosshair'),
      hitmarker: $('hitmarker'),
      fps: $('fps'),
      score: $('score'),
      healthNum: $('health-num'),
      healthBar: $('health-bar'),
      ammo: $('ammo'),
      ammoMag: document.querySelector('#ammo .mag'),
      ammoReserve: document.querySelector('#ammo .reserve'),
      ammoName: document.querySelector('#ammo .wname'),
      vignette: $('damage-vignette'),
      scope: $('scope-overlay'),
      menu: $('menu-overlay'),
      friends: $('friends-overlay'),
      friendsStatus: $('friends-status'),
      nameInput: $('name-input'),
      codeInput: $('code-input'),
      loadout: $('loadout-overlay'),
      diedLine: $('died-line'),
      roomLine: $('room-line'),
      roomCode: $('room-code'),
      roomTag: $('room-tag'),
      roomCodeTag: $('room-code-tag'),
      teamName: $('team-name'),
      cards: $('cards'),
      resume: $('resume-overlay'),
      matchTop: $('match-top'),
      timer: $('match-timer'),
      scoreRed: $('score-red'),
      scoreBlue: $('score-blue'),
      killfeed: $('killfeed'),
      scoreboard: $('scoreboard'),
      sbScores: $('sb-scores'),
      sbRed: $('sb-red'),
      sbBlue: $('sb-blue'),
      sbFoot: $('sb-foot'),
    };

    this.vignetteLevel = 0;
    this.onPick = null;

    this.el.nameInput.value = localStorage.getItem('depot-name') || '';
    this.el.codeInput.addEventListener('input', () => {
      this.el.codeInput.value = this.el.codeInput.value.toUpperCase().replace(/[^A-Z]/g, '');
    });

    const bar = (v) => `<div class="statbar"><i style="width:${Math.round(v * 100)}%"></i></div>`;
    this.el.cards.innerHTML = Object.values(WEAPONS).map((w) => {
      const m = WEAPON_META[w.id];
      return `
      <div class="card" data-weapon="${w.id}">
        <div class="wtitle">${w.name}</div>
        <div class="wtype">${m.type}</div>
        <div class="wdesc">${w.desc}</div>
        <div class="stat">DAMAGE ${bar(m.dmg)}</div>
        <div class="stat">FIRE RATE ${bar(m.rate)}</div>
        <div class="stat">CONTROL ${bar(m.range)}</div>
      </div>`;
    }).join('');
    this.el.cards.addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (card && this.onPick) this.onPick(card.dataset.weapon);
    });
  }

  // ---------- menu flow ----------
  showMenu(onBots, onFriends) {
    this.el.menu.classList.remove('hidden');
    document.getElementById('btn-bots').onclick = onBots;
    document.getElementById('btn-friends').onclick = onFriends;
  }
  hideMenu() { this.el.menu.classList.add('hidden'); }

  showFriends({ onCreate, onJoin, onBack }) {
    this.el.friends.classList.remove('hidden');
    this.setFriendsStatus('');
    const getName = () => {
      const name = (this.el.nameInput.value.trim() || 'PLAYER').toUpperCase();
      localStorage.setItem('depot-name', name);
      return name;
    };
    document.getElementById('btn-create').onclick = () => onCreate(getName());
    document.getElementById('btn-join').onclick = () => {
      const code = this.el.codeInput.value.trim().toUpperCase();
      if (code.length !== 5) { this.setFriendsStatus('Room codes are 5 letters.'); return; }
      onJoin(getName(), code);
    };
    document.getElementById('btn-back').onclick = onBack;
  }
  hideFriends() { this.el.friends.classList.add('hidden'); }
  setFriendsStatus(text) { this.el.friendsStatus.textContent = text; }

  showLoadout(died, onPick, room = null) {
    this.onPick = onPick;
    this.el.diedLine.classList.toggle('hidden', !died);
    this.el.roomLine.classList.toggle('hidden', !room);
    if (room) {
      this.el.roomCode.textContent = room.code;
      this.el.teamName.textContent = room.team.toUpperCase();
      this.el.teamName.style.color = room.team === 'red' ? '#ff6a55' : '#5f9dff';
    }
    this.el.loadout.classList.remove('hidden');
  }
  hideLoadout() { this.el.loadout.classList.add('hidden'); }

  showResume(onClick) {
    this.el.resume.classList.remove('hidden');
    this.el.resume.onclick = onClick;
  }
  hideResume() { this.el.resume.classList.add('hidden'); }

  // ---------- match UI ----------
  showMatchUI(code) {
    this.el.hud.classList.add('mp');
    this.el.matchTop.classList.remove('hidden');
    this.el.roomTag.classList.remove('hidden');
    this.el.roomCodeTag.textContent = code;
  }
  hideMatchUI() {
    this.el.hud.classList.remove('mp');
    this.el.matchTop.classList.add('hidden');
    this.el.roomTag.classList.add('hidden');
    this.el.killfeed.innerHTML = '';
  }

  setTimer(msLeft) {
    const s = Math.max(0, Math.ceil(msLeft / 1000));
    this.el.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.el.timer.classList.toggle('urgent', s <= 30);
  }

  setTeamScores(red, blue) {
    this.el.scoreRed.textContent = red;
    this.el.scoreBlue.textContent = blue;
  }

  killFeed(killerName, victimName, headshot, killerTeam) {
    const div = document.createElement('div');
    div.className = 'feed-item';
    div.innerHTML = `<b class="${killerTeam}">${killerName}</b> ${headshot ? '⌖' : '✕'} ${victimName}`;
    this.el.killfeed.prepend(div);
    while (this.el.killfeed.children.length > 4) this.el.killfeed.lastChild.remove();
    setTimeout(() => div.remove(), 6000);
  }

  setScoreboard(board, scores, myId, footer = '') {
    this.el.sbScores.textContent = `RED ${scores.red} — ${scores.blue} BLUE`;
    for (const team of ['red', 'blue']) {
      const el = team === 'red' ? this.el.sbRed : this.el.sbBlue;
      el.innerHTML = `<h3>${team.toUpperCase()}</h3>` + board
        .filter((p) => p.team === team)
        .sort((a, b) => b.kills - a.kills)
        .map((p) => `<div class="sb-row${p.id === myId ? ' me' : ''}"><span>${p.name}</span><span>${p.kills} / ${p.deaths}</span></div>`)
        .join('');
    }
    this.el.sbFoot.textContent = footer;
  }

  showScoreboard(visible) {
    this.el.scoreboard.classList.toggle('hidden', !visible);
  }

  setScope(visible) {
    this.el.scope.classList.toggle('hidden', !visible);
    this.el.crosshair.classList.toggle('hidden', visible);
  }

  // ---------- combat feedback ----------
  setHealth(hp) {
    const h = Math.max(0, Math.ceil(hp));
    this.el.healthNum.textContent = h;
    this.el.healthBar.style.width = `${h}%`;
    this.el.healthBar.classList.toggle('low', h <= 35);
  }

  setAmmo(w) {
    if (!w) return;
    this.el.ammoMag.textContent = w.reloading ? '--' : w.ammo;
    this.el.ammoReserve.textContent = `/ ${w.reserve}`;
    this.el.ammoName.textContent = WEAPONS[w.id].name;
    this.el.ammo.classList.toggle('reloading', w.reloading);
  }

  setScore(kills, deaths) {
    this.el.score.textContent = `KILLS ${kills} — DEATHS ${deaths}`;
  }

  setFps(fps) {
    this.el.fps.textContent = `${Math.round(fps)} FPS`;
  }

  setCrosshairSpread(spreadRad) {
    const px = 5 + spreadRad * 900;
    this.el.crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
  }

  hitmarker(kind) { // 'hit' | 'head' | 'kill'
    const el = this.el.hitmarker;
    el.classList.remove('show', 'head', 'kill');
    void el.offsetWidth; // restart animation
    if (kind !== 'hit') el.classList.add(kind);
    el.classList.add('show');
  }

  damageNumber(x, y, amount, headshot) {
    const span = document.createElement('span');
    span.className = 'dmgnum' + (headshot ? ' head' : '');
    span.textContent = amount;
    span.style.left = `${x + (Math.random() * 24 - 12)}px`;
    span.style.top = `${y}px`;
    this.el.hud.appendChild(span);
    setTimeout(() => span.remove(), 720);
  }

  damageFlash() {
    this.vignetteLevel = Math.min(1, this.vignetteLevel + 0.45);
  }

  update(dt) {
    if (this.vignetteLevel > 0) {
      this.vignetteLevel = Math.max(0, this.vignetteLevel - dt * 1.6);
      this.el.vignette.style.opacity = this.vignetteLevel.toFixed(2);
    }
  }
}
