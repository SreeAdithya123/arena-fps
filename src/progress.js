// Session stats + localStorage cosmetic unlocks. No accounts, no server.
// Lifetime kills gate the unlocks; session stats reset on page load.

const KEY = 'depot-progress';

export const CROSSHAIRS = [
  { id: 'cross', name: 'CROSS', unlock: 0 },
  { id: 'dot', name: 'DOT', unlock: 25 },
  { id: 'circle', name: 'RING', unlock: 75 },
  { id: 'tbar', name: 'T-BAR', unlock: 150 },
];

export const ACCENTS = [
  { id: 'gold', name: 'GOLD', color: '#ffcf40', unlock: 0 },
  { id: 'cyan', name: 'CYAN', color: '#3fd6c2', unlock: 40 },
  { id: 'magenta', name: 'MAGENTA', color: '#e04fd0', unlock: 100 },
  { id: 'lime', name: 'LIME', color: '#a4e03d', unlock: 200 },
];

function load() {
  try {
    return { lifeKills: 0, lifeWins: 0, crosshair: 'cross', accent: 'gold', ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { lifeKills: 0, lifeWins: 0, crosshair: 'cross', accent: 'gold' };
  }
}

export class Progress {
  constructor() {
    this.data = load();
    this.session = { kills: 0, deaths: 0, wins: 0 };
    this.onChange = null;
  }

  save() {
    localStorage.setItem(KEY, JSON.stringify(this.data));
    if (this.onChange) this.onChange();
  }

  addKill() {
    this.session.kills++;
    this.data.lifeKills++;
    this.save();
  }

  addDeath() {
    this.session.deaths++;
    if (this.onChange) this.onChange();
  }

  addWin() {
    this.session.wins++;
    this.data.lifeWins++;
    this.save();
  }

  unlocked(item) {
    return this.data.lifeKills >= item.unlock;
  }

  setCrosshair(id) {
    const c = CROSSHAIRS.find((x) => x.id === id);
    if (c && this.unlocked(c)) { this.data.crosshair = id; this.save(); }
  }

  setAccent(id) {
    const a = ACCENTS.find((x) => x.id === id);
    if (a && this.unlocked(a)) { this.data.accent = id; this.save(); }
  }

  get accentColor() {
    return (ACCENTS.find((a) => a.id === this.data.accent) || ACCENTS[0]).color;
  }
}
