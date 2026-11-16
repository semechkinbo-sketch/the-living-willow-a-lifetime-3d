/* Compatibility update: safe startup, bounded canvas memory, touch and keyboard controls.
   Season buttons enter a season without pausing its living cycle.
   Buds, leaves, flowers, leaf fall and snow develop continuously. */
(function () {
let livingTreeStarted = false;
function startLivingTree() {
if (livingTreeStarted) return;
/* The Living Willow: A Lifetime 3D
   An interactive living painting: a weeping willow by its pond, four seasons in a loop,
   day and night, rain, snow, wind, drifting golden catkins in spring.
   Everything is drawn in code, no external files. */
'use strict';

/* ---------- Seeded randomness: the tree is always the same ---------- */
function mulberry32(seed) {
	return function () {
		seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
let rng = mulberry32(20261116);
function reseed(s) { rng = mulberry32(s); }
function rand(a, b) { return a + (b - a) * rng(); }

/* ---------- URL parameters (for testing) ---------- */
let query = '';
try {
 query = window.FORCED_PARAMS || location.search || '';
} catch (e) {
 query = '';
}
const params = { get(key) { const m = new RegExp('(?:^|[?&])' + key + '=([^&]*)').exec(query); return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null; }, has(key) { return this.get(key) !== null; } };
const paramSeason = params.get('season');		   // spring|summer|autumn|winter
const paramTime = params.get('time');			   // day|night
const paramWeather = params.get('weather');		 // rain|snow|storm|clear
const speedMul = Math.max(0.1, parseFloat(params.get('speed') || '1') || 1);
const paramAge = parseInt(params.get('age') || '', 10);   // 1..200 - tree age in years

/* ---------- Canvas ---------- */
const stageEl = document.getElementById('stage');
const canvas = document.getElementById('scene');
if (!canvas) return;
livingTreeStarted = true;
let ctx = canvas.getContext('2d');
if (!ctx) { const note = document.createElement('p'); note.textContent = 'Canvas is unavailable. Please open this project in an up-to-date browser.'; document.getElementById('stage').appendChild(note); return; }
const mainCtx = ctx;
const treeCv = document.createElement('canvas');
const treeCtx = treeCv.getContext('2d');
let treeCacheT = -1, TREE_INTERVAL = 0.05, cacheOn = true;
let W = 0, H = 0, DPR = 1, groundY = 0;

/* ---------- World state ---------- */
const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'];
const SEASON_IDS = ['spring', 'summer', 'autumn', 'winter'];
const SEASON_SECONDS = 80;				 // one season in the automatic cycle
let yearT = 1.15;						  // 0..4 - continuous time of year
let ageYears = 200, ageTarget = 200, ageIntro = false;   // tree age in years, eased toward ageTarget
let lastAgeYears = 200;
let yaw = 0, yawVel = 0, cosYaw = 1, sinYaw = 0, orbitDrag = false, cacheYaw = -1;   /* orbit around the trunk */
let growHold = 0, growHeld = 0;   /* 1 growing older / -1 growing younger while a finger rests on the ground */
if (!isNaN(paramAge)) { ageYears = ageTarget = Math.max(1, Math.min(200, paramAge)); }
else { ageYears = ageTarget = 3; }   /* opening: a young tree; you grow the rest yourself */
if (paramSeason) {
	const i = SEASON_IDS.indexOf(paramSeason);
	if (i >= 0) yearT = i + 0.02;
}
let previousSeason = currentSeason(); // detect natural boundaries without freezing the year
let dayNight = paramTime === 'night' ? 1 : 0;   // 0 - day, 1 - night
let dayNightTarget = dayNight;
let windSmooth = 0.4, gust = 0, gustTarget = 0, gustTimer = 4;
let precipMode = 'off';					// off|rain|snow|storm
let precipLevel = 0, rainVisibility = 0, snowVisibility = 0;					   // smooth precipitation strength 0..1
if (paramWeather && paramWeather !== 'clear') precipMode = paramWeather;
let snowAmount = 0;   // snow on branches and ground
let fishT = -1, fishNext = 15, fishX = 0, fishY = 0, fishDir = 1;   /* the pond fish: rare summer splashes, never a show */
let autoWeatherTimer = rand(22, 38);
let prevPrecipMode = 'off';
let autoDN = paramTime ? false : true, dnTimer = 55;   /* automatic day/night cycle; tapping the sun/moon switches manually */
let lightning = 0, lightningTimer = rand(14, 26);

/* ---------- Sound (synthesized, like in Forest House) ---------- */
const Sound = {
	ctx: null, master: null, started: false, windGain: null, rainGain: null,
	ensure() {
		if (!this.ctx) {
			const AC = window.AudioContext || window.webkitAudioContext;
			if (!AC) return null;
			try { this.ctx = new AC(); } catch (_) { return null; }
			this.master = this.ctx.createGain();
			this.master.gain.value = 1;
			this.master.connect(this.ctx.destination);
		}
		if (this.ctx.state === 'suspended') { const resumed = this.ctx.resume(); if (resumed && resumed.catch) resumed.catch(() => {}); }
		return this.ctx;
	},
	start() {
		if (this.started) return;
		const ctx = this.ensure(); if (!ctx) return;
		this.started = true;
		this.windGain = this.noiseLoop('lowpass', 320, 0.04);
		this.rainGain = this.noiseLoop('bandpass', 1400, 0.0001);
	},
	noiseLoop(type, freq, gainVal) {
		const ctx = this.ctx;
		const len = ctx.sampleRate * 2;
		const buf = ctx.createBuffer(1, len, ctx.sampleRate);
		const out = buf.getChannelData(0);
		for (let i = 0; i < len; i++) out[i] = Math.random() * 2 - 1;
		const src = ctx.createBufferSource();
		src.buffer = buf; src.loop = true;
		const filt = ctx.createBiquadFilter();
		filt.type = type; filt.frequency.value = freq; filt.Q.value = 0.6;
		const g = this.ctx.createGain();
		g.gain.setValueAtTime(gainVal, ctx.currentTime);
		src.connect(filt); filt.connect(g); g.connect(this.master);
		src.start();
		return g;
	},
	setWind(v) {
		if (!this.windGain || !this.ctx) return;
		this.windGain.gain.setTargetAtTime(0.015 + v * 0.15, this.ctx.currentTime, 0.4);
	},
	setRain(v) {
		if (!this.rainGain || !this.ctx) return;
		this.rainGain.gain.setTargetAtTime(v > 0.02 ? 0.03 + v * 0.11 : 0.0001, this.ctx.currentTime, 0.6);
	},
	blip(fA, fB, dur, vol, type, at) {
		const ctx = this.ensure(); if (!ctx) return;
		const now = ctx.currentTime + (at || 0);
		const osc = ctx.createOscillator(), g = ctx.createGain();
		osc.type = type || 'sine';
		osc.frequency.setValueAtTime(fA, now);
		osc.frequency.exponentialRampToValueAtTime(Math.max(fB, 1), now + dur);
		g.gain.setValueAtTime(vol, now);
		g.gain.exponentialRampToValueAtTime(0.001, now + dur);
		osc.connect(g); g.connect(this.master);
		osc.start(now); osc.stop(now + dur + 0.05);
	},
	bird() {
		const base = rand(1900, 2700);
		for (let i = 0; i < 3; i++) this.blip(base + rand(-300, 500), base + rand(200, 700), 0.09, 0.03, 'sine', i * 0.13);
	},
	owl() {
		this.blip(340, 300, 0.25, 0.05, 'sine', 0);
		this.blip(320, 280, 0.35, 0.05, 'sine', 0.4);
	},
	cricket() {
		for (let i = 0; i < 4; i++) this.blip(4200, 4300, 0.03, 0.012, 'square', i * 0.07);
	},
	thunder() {
		const ctx = this.ensure(); if (!ctx) return;
		const now = ctx.currentTime;
		const osc = ctx.createOscillator(), g = ctx.createGain();
		osc.type = 'sawtooth';
		osc.frequency.setValueAtTime(90, now);
		osc.frequency.exponentialRampToValueAtTime(30, now + 0.9);
		g.gain.setValueAtTime(0.22, now);
		g.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
		osc.connect(g); g.connect(this.master);
		osc.start(now); osc.stop(now + 1.05);
		const len = ctx.sampleRate * 0.5;
		const buf = ctx.createBuffer(1, len, ctx.sampleRate);
		const out = buf.getChannelData(0);
		for (let i = 0; i < len; i++) out[i] = (Math.random() * 2 - 1) * (1 - i / len);
		const src = ctx.createBufferSource(); src.buffer = buf;
		const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 220;
		const g2 = ctx.createGain(); g2.gain.value = 0.12;
		src.connect(filt); filt.connect(g2); g2.connect(this.master);
		src.start();
	}
};

/* ---------- Colors and palettes ---------- */
function smoothstep(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpC(c1, c2, t) {
	return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}
function css(c, a) {
	return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (a === undefined ? 1 : a) + ')';
}
const SKY = {
	day: {
		spring: [[126,186,232],[178,214,240],[222,238,248]],
		summer: [[70,140,215],[140,195,238],[215,238,250]],
		autumn: [[96,140,180],[158,188,212],[226,232,236]],
		winter: [[120,150,180],[172,196,216],[224,234,240]]
	},
	dusk:  [[68,60,110],[186,110,90],[248,180,120]],
	night: [[6,12,32],[16,28,58],[38,54,86]]
};
const GRASS = { spring: [110,168,84], summer: [86,150,66], autumn: [148,132,70], winter: [196,204,212] };

function seasonWeights() {
	const w = [0, 0, 0, 0];
	const t = ((yearT % 4) + 4) % 4;
	const i = Math.floor(t), f = t - i;
	const blend = smoothstep(0.70, 1, f);   /* blend in the last 25% of the season */
	w[i] += 1 - blend; w[(i + 1) % 4] += blend;
	return w;
}
function seasonProgress() {
	const t = ((yearT % 4) + 4) % 4;
	return t - Math.floor(t);
}
function currentSeason() { return Math.floor(((yearT % 4) + 4) % 4); }

function skyPalette() {
	const w = seasonWeights();
	const top = [0,0,0], mid = [0,0,0], hor = [0,0,0];
	for (let i = 0; i < 4; i++) {
		const p = SKY.day[SEASON_IDS[i]];
		for (let k = 0; k < 3; k++) {
			top[k] += p[0][k] * w[i]; mid[k] += p[1][k] * w[i]; hor[k] += p[2][k] * w[i];
		}
	}
	const mix = (dayC, duskC, nightC, t) =>
		t < 0.5 ? lerpC(dayC, duskC, t * 2) : lerpC(duskC, nightC, (t - 0.5) * 2);
	return {
		top: mix(top, SKY.dusk[0], SKY.night[0], dayNight),
		mid: mix(mid, SKY.dusk[1], SKY.night[1], dayNight),
		hor: mix(hor, SKY.dusk[2], SKY.night[2], dayNight)
	};
}

/* ---------- The tree ---------- */
const MAX_DEPTH = 9;
let segments = [];
let roots = [];
let mossSpots = [];
let leaves = [];
let treeCX = 0, treeBase = 0, treeScale = 1;

function buildTree() {
	reseed(20261116);   /* the same willow at any resize */
	segments = []; leaves = []; roots = [];
	treeCX = W * 0.5;
	treeBase = groundY + H * 0.012;
	treeScale = Math.min(H * 0.68, W * 0.84) / 100;
	function normA(a) { while (a > Math.PI) a -= 6.2832; while (a < -Math.PI) a += 6.2832; return a; }
	function addSeg(parent, depth, ang, len, w1, w2, bend, azim) {
		const idx = segments.length;
		const seg = {
			parent, depth, len, w: w1, w2, angAbs: ang, bend, azim: azim || 0,
			bornAt: depth === 0 ? 0.05 + segments.length * 0.04 : Math.min(0.82, 0.08 + ((depth - 1) / (MAX_DEPTH - 1)) * 0.60 + rand(0, 0.03)),   /* age when this part of the tree appears */
			phase: rand(0, Math.PI * 2),
			flex: (depth >= 3 ? 0.0024 : 0.0016) * Math.pow(depth, 1.7),   /* hanging strands are whiplike */
			x1: 0, y1: 0, z1: 0, cx: 0, cy: 0, cz: 0, x2: 0, y2: 0, z2: 0, sway: 0, drawAng: ang, endAng: ang + bend, tex: null
		};
		if (depth <= 3) {
			seg.tex = [];
			const n = depth === 0 ? 34 : (depth === 1 ? 20 : 10);
			for (let i = 0; i < n; i++) seg.tex.push({ t: rand(0.02, 0.95), o: rand(-0.42, 0.42), l: rand(0.08, 0.28), d: rng() < 0.7 ? 0 : 1 });
		}
		segments.push(seg);
		return idx;
	}
	function addLeaves(idx, depth) {
		const n = depth >= 6 ? 2 : 3;
		for (let l = 0; l < n; l++) {
			leaves.push({
				seg: idx, t: rand(0.2, 1.0), off: depth >= 3 ? rand(-1.8, 1.8) : rand(-4.6, 4.6),
				size: depth >= 3 ? rand(3.4, 5.2) : rand(4.4, 7.0), phase: rand(0, Math.PI * 2),
				rot0: rand(0, Math.PI * 2),
				grow: rand(0, 0.55),
				colDelay: rand(0, 0.45),
				fallAt: rand(0.14, 0.97),
				hue: rng(),
				young: depth <= 2,   /* foliage of the young tree, hands over to the outer crown with age */
				winterKeep: rng() < 0.03,
				state: 'attached', fx: 0, fy: 0, fvx: 0, fvy: 0, frot: 0, fspin: 0
			});
		}
	}
	function reach0(v) { return v < 10 ? rand(0.6, 1.6) : (v < 16 ? rand(2.0, 2.8) : rand(3.0, 3.8)); }
	function grow(parent, depth, ang, len, w1, azim, py) {
		const up = -Math.PI / 2, down = Math.PI / 2;
		const toUp = normA(up - ang);
		const toDown = normA(down - ang);
		/* limbs climb a little, then gravity takes the outer wood: every deeper
		   generation bends harder toward straight down, the willow's signature */
		let bend;
		if (depth <= 1) bend = toUp * 0.20 + rand(-0.18, 0.18);
		else if (depth === 2) bend = toDown * 0.18 + rand(-0.16, 0.16);
		else bend = toDown * 0.42 + rand(-0.14, 0.14);
		const w2 = w1 * (depth >= 3 ? rand(0.78, 0.9) : rand(0.62, 0.76));
		const idx = addSeg(parent, depth, ang, len, w1, w2, bend, azim);
		const endAng = ang + bend;
		const y2 = py + Math.sin(ang + bend * 0.5) * len;   /* approximate tip height, without sway */
		if (depth < MAX_DEPTH && len > 2.2 && w1 > 0.18 && y2 < -5) {   /* a strand stops just above the ground, never through it */
			const kids = depth < 2 ? 3 : (depth < 4 ? (rng() < 0.6 ? 2 : 3) : (rng() < 0.68 ? 1 : 2));
			for (let k = 0; k < kids; k++) {
				const dir = kids === 1 ? 0 : (k / (kids - 1)) * 2 - 1;
				const spread = depth >= 3 ? dir * rand(0.08, 0.26) + rand(-0.08, 0.08) : dir * rand(0.3, 0.62) + rand(-0.12, 0.12);
				grow(idx, depth + 1, endAng + spread,
					len * (depth >= 3 ? rand(0.84, 0.95) : rand(0.64, 0.78)),
					w2 * (depth >= 3 ? rand(0.84, 0.94) : rand(0.78, 0.9)),
					azim + (depth >= 3 ? rand(-0.5, 0.5) : rand(-0.85, 0.85)), y2);   /* children fan out around the trunk, not only in one plane */
			}
		}
		if (depth >= 1) addLeaves(idx, depth);   /* young trees leaf out on the branches they have */
	}
	/* willow trunk: short and massive with a gentle lean; the limbs leave high and pour over */
	let prev = -1, ang = -Math.PI / 2 + 0.09, trunkY = 0;
	const tw = [12.2, 10.2, 8.2, 6.6];
	const bends = [-0.1, 0.16, -0.07];
	for (let i = 0; i < 3; i++) {
		const idx = addSeg(prev, 0, ang, 8.6, tw[i], tw[i + 1], bends[i]);
		trunkY += Math.sin(ang + bends[i] * 0.5) * 8.6;
		ang += bends[i];
		if (i === 1) {
			grow(idx, 1, ang + 1.0, 16, 4.4, 0.5, trunkY);
			grow(idx, 1, ang - 1.05, 15.5, 4.2, 3.6, trunkY);
		}
		prev = idx;
	}
	/* crown limbs fan out around the top, then arch and weep */
	const kids = 4;
	const topAz = [0.9, 2.35, 3.9, 5.2];
	for (let k = 0; k < kids; k++) {
		const dir = (k / (kids - 1)) * 2 - 1;
		grow(prev, 1, ang + dir * 0.55 + rand(-0.07, 0.07), 17.5 * rand(0.92, 1.05), 4.6, topAz[k] + rand(-0.2, 0.2), trunkY);
	}
	/* tip tufts: each trunk segment carries small leaves near its top while the tree is young */
	for (let ti = 0; ti <= 2; ti++) {
		for (let l = 0; l < 7; l++) {
			leaves.push({
				seg: ti, t: rand(0.55, 1.0), off: rand(-3.2, 3.2),
				size: rand(4.0, 6.4), phase: rand(0, Math.PI * 2),
				rot0: rand(0, Math.PI * 2),
				grow: rand(0, 0.3),
				colDelay: rand(0, 0.45),
				fallAt: rand(0.14, 0.97),
				hue: rng(),
				young: true,
				winterKeep: false,
				state: 'attached', fx: 0, fy: 0, fvx: 0, fvy: 0, frot: 0, fspin: 0
			});
		}
	}
	/* roots: spread wide from the trunk, bend and dive into the ground */
	const rdefs = [[-1, 22, 5.2], [-1, 13, 4.2], [-1, 7, 3.2], [1, 7, 3.2], [1, 14, 4.3], [1, 23, 5.3]];
	for (const r of rdefs) {
		const side = r[0], reach = r[1] + rand(-2, 2), w = r[2];
		const sx = side * (reach0(r[1]) );
		roots.push({ sx, sy: -9, ex: side * reach, ey: rand(0.5, 2.5), w, c: rand(0.2, 0.5), tw: [], azim: (side < 0 ? Math.PI : 0) + rand(-0.55, 0.55) });
		if (reach > 14) {
			const rr = roots[roots.length - 1];
			for (let k = 0; k < 2; k++) rr.tw.push({ t: rand(0.45, 0.7), dx: side * rand(5, 9), dy: rand(0.5, 2.5), w: w * 0.38 });
		}
	}
	/* after a rebuild (screen rotation, URL bar) compute geometry at once and keep the season's foliage stage */
	updateTree(0);
	{
		const t4b = ((yearT % 4) + 4) % 4, spb = seasonProgress();
		for (const lf of leaves) {
			if (t4b >= 3 && !lf.winterKeep) lf.state = 'gone';
			else if (t4b >= 2 && t4b < 3 && spb > lf.fallAt && !lf.winterKeep) lf.state = 'gone';
		}
	}
	/* moss on the north side (visible in spring and summer) */
	mossSpots = [];
	for (let i = 0; i < 14; i++) mossSpots.push({ t: rand(0.05, 0.95), o: rand(-0.4, -0.05), r: rand(0.5, 1.2) });
}

/* Leaf sprites in several colors */
const LEAF_COLORS = [
	[178, 216, 96],   // 0 spring fresh yellow-green
	[116, 182, 74],   // 1 summer willow green
	[88, 152, 60],	// 2 summer dark
	[236, 200, 66],   // 3 golden yellow
	[220, 164, 48],   // 4 amber
	[196, 120, 44],	// 5 rust
	[158, 124, 66]	 // 6 dry
];
let leafSprites = [];
function buildLeafSprites() {
	leafSprites = LEAF_COLORS.map(c => {
		const s = document.createElement('canvas');
		s.width = s.height = 32;
		const g = s.getContext('2d');
		g.translate(16, 16);
		const grad = g.createLinearGradient(0, -12, 0, 12);
		grad.addColorStop(0, css([c[0] + 26, c[1] + 26, c[2] + 20]));
		grad.addColorStop(1, css([c[0] - 22, c[1] - 22, c[2] - 14]));
		g.fillStyle = grad;
		g.beginPath();
		g.moveTo(0, -14);
		g.bezierCurveTo(4.4, -8, 4.4, 7, 0, 14);
		g.bezierCurveTo(-4.4, 7, -4.4, -8, 0, -14);
		g.fill();
		g.strokeStyle = css([c[0] - 45, c[1] - 45, c[2] - 30], 0.8);
		g.lineWidth = 1;
		g.beginPath(); g.moveTo(0, -11); g.lineTo(0, 12); g.stroke();
		return s;
	});
}

/* pre-rotated sprite copies: a leaf is drawn without changing the transform, noticeably cheaper */
const ROT_STEPS = 24;
let rotSprites = [];
function buildRotSprites() {
	rotSprites = leafSprites.map(sp => {
		const arr = [];
		for (let k = 0; k < ROT_STEPS; k++) {
			const c = document.createElement('canvas');
			c.width = c.height = 40;
			const g = c.getContext('2d');
			g.translate(20, 20);
			g.rotate(k * Math.PI * 2 / ROT_STEPS);
			g.drawImage(sp, -16, -16);
			arr.push(c);
		}
		return arr;
	});
}

/* ---------- Spring catkin drift (a willow sheds gold, not pink) ---------- */
const PETAL_COLORS = [
	[250, 244, 214],   // pale cream
	[246, 228, 160],   // soft yellow
	[238, 208, 130]	// deeper gold
];
let petalSprites = [];
function buildPetalSprites() {
	petalSprites = PETAL_COLORS.map(c => {
		const s = document.createElement('canvas');
		s.width = s.height = 24;
		const g = s.getContext('2d');
		g.translate(12, 12);
		const grad = g.createLinearGradient(0, -9, 0, 9);
		grad.addColorStop(0, css([c[0], Math.min(255, c[1] + 16), Math.min(255, c[2] + 12)]));
		grad.addColorStop(1, css([c[0] - 12, c[1] - 24, c[2] - 18]));
		g.fillStyle = grad;
		g.beginPath();
		g.moveTo(0, -9);
		g.bezierCurveTo(6.5, -6, 6.5, 5, 0, 9);
		g.bezierCurveTo(-6.5, 5, -6.5, -6, 0, -9);
		g.fill();
		return s;
	});
}

/* ---------- Far background, ground, stars (pre-render) ---------- */
let hillsFar = null, hillsNear = null, groundCanvas = null, starsCanvas = null;
/* integer sine frequencies over W, so the strip wraps seamlessly when the viewpoint turns */
function hillY(x, baseY, amp, ph1, ph2) {
	return baseY + Math.sin(x * 6.2832 * 2 / W + ph1) * amp * 0.5
		+ Math.sin(x * 6.2832 * 5 / W + ph2) * amp * 0.28;
}
function buildBackground() {
	for (let layer = 0; layer < 2; layer++) {
		const cv = document.createElement('canvas');
		cv.width = W * DPR; cv.height = H * DPR;
		const g = cv.getContext('2d');
		g.scale(DPR, DPR);
		const baseY = groundY - H * (layer === 0 ? 0.10 : 0.045);
		const amp = H * (layer === 0 ? 0.06 : 0.035);
		const ph1 = layer * 2.4, ph2 = layer * 5.1;
		g.beginPath();
		g.moveTo(0, H);
		for (let x = 0; x <= W + 2; x += 4) g.lineTo(x, hillY(x, baseY, amp, ph1, ph2));
		g.lineTo(W + 2, H); g.closePath();
		g.fillStyle = layer === 0 ? '#5a7250' : '#47603f';
		g.fill();
		if (layer === 0) hillsFar = cv; else hillsNear = cv;
	}
	{   /* fir trees on the near ridge, kept off the wrap seam */
		const g = hillsNear.getContext('2d');
		g.scale(DPR, DPR);
		const baseY = groundY - H * 0.045, amp = H * 0.035;
		g.fillStyle = '#3c5436';
		for (let i = 0; i < 26; i++) {
			const tx = Math.max(16, Math.min(W - 16, (i / 26) * W + rand(-10, 10)));
			const ty = hillY(tx, baseY, amp, 2.4, 5.1);
			const th = rand(10, 26);
			g.beginPath();
			g.moveTo(tx, ty - th);
			g.lineTo(tx + th * 0.32, ty);
			g.lineTo(tx - th * 0.32, ty);
			g.closePath(); g.fill();
		}
	}
	groundCanvas = document.createElement('canvas');
	groundCanvas.width = W * DPR; groundCanvas.height = H * DPR;
	const gg = groundCanvas.getContext('2d');
	gg.scale(DPR, DPR);
	const grad = gg.createLinearGradient(0, groundY - 10, 0, H);
	grad.addColorStop(0, '#6a9950');
	grad.addColorStop(0.25, '#578541');
	grad.addColorStop(1, '#3d5c2e');
	gg.fillStyle = grad;
	gg.beginPath();
	gg.moveTo(0, groundY + 6);
	for (let x = 0; x <= W + 12; x += 10) gg.lineTo(x, groundY + Math.sin(x * 0.02) * 3 + Math.sin(x * 0.006 + 2) * 5);
	gg.lineTo(W + 20, H); gg.lineTo(0, H); gg.closePath();
	gg.fill();
	gg.strokeStyle = 'rgba(0,0,0,0.10)';
	gg.lineWidth = 1;
	for (let i = 0; i < 700; i++) {
		const x = rand(0, W), y = rand(groundY + 4, H);
		gg.beginPath(); gg.moveTo(x, y); gg.lineTo(x + rand(-2, 2), y - rand(2, 6)); gg.stroke();
	}
	starsCanvas = document.createElement('canvas');
	starsCanvas.width = W * DPR; starsCanvas.height = H * DPR;
	const sg = starsCanvas.getContext('2d');
	sg.scale(DPR, DPR);
	for (let i = 0; i < 130; i++) {
		const x = rand(0, W), y = rand(0, groundY * 0.75), r = rand(0.4, 1.4);
		sg.fillStyle = 'rgba(255,255,255,' + rand(0.3, 0.95).toFixed(2) + ')';
		sg.beginPath(); sg.arc(x, y, r, 0, 7); sg.fill();
	}
}

/* ---------- Particles ---------- */
let rainDrops = [], snowFlakes = [], groundLeaves = [], fireflies = [], flowers = [], birdsFly = [], petals = [];
let birdTimer = 6;
function newPetal(scattered) {
	const crownF = 0.25 + 0.75 * ageG();   /* petals drift from the crown the tree actually has */
	return {
		x: treeCX + rand(-46, 46) * treeScale * crownF,
		y: scattered ? rand(treeBase - 96 * treeScale * crownF, groundY - 10) : treeBase - rand(28, 96) * treeScale * crownF,
		v: rand(14, 26), swayAmp: rand(10, 26), ph: rand(0, 6.28),
		rot: rand(0, 6.28), spin: rand(-1.6, 1.6),
		size: rand(5.5, 9), c: Math.floor(rand(0, 2.99)), land: 0
	};
}
/* the pond's shoreline: one organic closed outline, shared by the water, the rim and the meadow's keep-out test */
let pondX = 0, pondY = 0, pondRX = 1, pondRY = 1, pondOutline = [];
function buildPondOutline() {
	pondX = treeCX + W * 0.235; pondY = groundY + (H - groundY) * 0.40;
	pondRX = W * 0.16;
	/* seen at a low angle: the pond is a wide, shallow shape lying on the ground, never a tall oval */
	pondRY = Math.min((H - groundY) * 0.26, pondRX * 0.27);
	/* keep the whole pond clear of the season buttons along the bottom edge */
	pondY = Math.max(groundY + pondRY * 1.05, Math.min(pondY, H - 58 - pondRY * 1.2));
	pondOutline = [];
	for (let k = 0; k < 18; k++) {
		const a = (k / 18) * 6.2832;
		const r = 1 + rand(-1, 1) * 0.09 + Math.sin(a * 3 + 0.7) * 0.07 + Math.sin(a * 5 + 2.2) * 0.045;
		pondOutline.push({ ux: Math.cos(a) * r, uy: Math.sin(a) * r });
	}
}
function inPond(x, y, margin) {
	const nx = (x - pondX) / pondRX, ny = (y - pondY) / pondRY;
	let inside = false;
	for (let i = 0, j = pondOutline.length - 1; i < pondOutline.length; j = i++) {
		const xi = pondOutline[i].ux * margin, yi = pondOutline[i].uy * margin;
		const xj = pondOutline[j].ux * margin, yj = pondOutline[j].uy * margin;
		if ((yi > ny) !== (yj > ny) && nx < ((xj - xi) * (ny - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}
function pondPath(scale) {
	const n = pondOutline.length;
	const sx = i => pondX + pondOutline[i % n].ux * pondRX * scale;
	const sy = i => pondY + pondOutline[i % n].uy * pondRY * scale;
	ctx.beginPath();
	ctx.moveTo((sx(0) + sx(n - 1)) / 2, (sy(0) + sy(n - 1)) / 2);
	for (let i = 0; i < n; i++) ctx.quadraticCurveTo(sx(i), sy(i), (sx(i) + sx(i + 1)) / 2, (sy(i) + sy(i + 1)) / 2);
	ctx.closePath();
}
function buildParticles() {
	rainDrops = []; snowFlakes = []; fireflies = []; groundLeaves = [];
	flowers = [];
	/* the pond is water, not a flower bed: the meadow keeps a margin from its edge */
	buildPondOutline();
	for (let i = 0; i < 46; i++) {
		let fx = 0, fy = 0, tries = 0;
		do {
			fx = rand(0, W); fy = rand(groundY + 8, H - 8);
			tries++;
		} while (tries < 24 && inPond(fx, fy, 1.14));
		flowers.push({ x: fx, y: fy, c: [[255,255,255],[250,220,90],[240,150,200],[180,160,250]][i % 4], s: rand(1.4, 2.6), ph: rand(0, 6.28) });
	}
	for (let i = 0; i < 240; i++) rainDrops.push({ x: rand(0, W), y: rand(-H, 0), v: rand(900, 1250), len: rand(12, 22) });
	for (let i = 0; i < 420; i++) snowFlakes.push({ x: rand(0, W), y: rand(-H, H), v: rand(35, 75), r: rand(1.0, 2.1), ph: rand(0, 6.28) });
	for (let i = 0; i < 18; i++) fireflies.push({ x: rand(0, W), y: rand(groundY - H * 0.3, groundY), ph: rand(0, 6.28), sp: rand(0.2, 0.6) });
	petals = [];
	for (let i = 0; i < 22; i++) petals.push(newPetal(true));
}

/* ---------- Clouds ---------- */
const clouds = [];
for (let i = 0; i < 4; i++) clouds.push({ x: rng(), y: rand(0.06, 0.2), s: rand(0.7, 1.4), v: rand(0.004, 0.01) });
const bigCloud = { x: 0.16, y: 0.32, s: 1.5 };   /* below the sun/moon path: the weather tap never sits on the celestial tap */

/* ---------- Seasonal values ---------- */
function leafStage() {
	const t = ((yearT % 4) + 4) % 4;
	if (t < 1) return Math.min(1, seasonProgress() * 1.5);   // spring: growing out
	if (t < 3) return 1;									 // summer and autumn
	return 0;												// winter
}
function autumnColorMix() {
	const t = ((yearT % 4) + 4) % 4;
	if (t < 2) return 0;
	if (t < 3) return Math.min(1, seasonProgress() * 1.35);
	return 1;
}

/* ---------- Tree geometry with sway ---------- */
/* world units -> screen: yaw turns the whole tree around the vertical trunk axis.
   zv is the view depth: larger means closer to the viewer, so drawing ascending zv is back-to-front. */
function segPt(s, t, out) {
	const u = 1 - t;
	const wx = u * u * s.x1 + 2 * u * t * s.cx + t * t * s.x2;
	const wy = u * u * s.y1 + 2 * u * t * s.cy + t * t * s.y2;
	const wz = u * u * s.z1 + 2 * u * t * s.cz + t * t * s.z2;
	const tx = 2 * u * (s.cx - s.x1) + 2 * t * (s.x2 - s.cx);
	const ty = 2 * u * (s.cy - s.y1) + 2 * t * (s.y2 - s.cy);
	const tz = 2 * u * (s.cz - s.z1) + 2 * t * (s.z2 - s.cz);
	const sx = wx * cosYaw + wz * sinYaw, stx = tx * cosYaw + tz * sinYaw;
	out.x = treeCX + sx * treeScale;
	out.y = treeBase + wy * treeScale;
	out.zv = -wx * sinYaw + wz * cosYaw;
	const l = Math.hypot(stx, ty) || 1;
	out.nx = -ty / l; out.ny = stx / l;
	return out;
}
const _pt = { x: 0, y: 0, nx: 0, ny: 1 };
function updateTree(time) {
	const gAge = ageG();
	cosYaw = Math.cos(yaw); sinYaw = Math.sin(yaw);
	const swayGlobal = (0.25 + windSmooth * 1.5) * (1 + (1 - gAge) * 0.9);   /* young trees are flexible */
	const widAge = 1 + smoothstep(0.7, 1, gAge) * 0.3;						 /* old trunks grow massive */
	for (let i = 0; i < segments.length; i++) {
		const s = segments[i];
		const win = s.depth === 0 ? 0.16 : 0.12;
		const gf = smoothstep(s.bornAt, s.bornAt + win, Math.max(gAge, 0.02));
		s.gf = gf;
		const lenF = Math.pow(gf, 0.9);
		const widF = Math.pow(gf, 1.5) * (s.depth <= 1 ? widAge : 1);   /* saplings are slender */
		s.wEff = s.w * widF;
		s.w2Eff = s.w2 * widF;
		let px = 0, py = 0, pz = 0, pSway = 0;
		if (s.parent >= 0) {
			const p = segments[s.parent];
			px = p.x2; py = p.y2; pz = p.z2; pSway = p.sway;
		}
		const sway = pSway + swayGlobal * s.flex * 60 * Math.sin(time * (s.depth >= 3 ? 0.5 + s.depth * 0.09 : 0.9 + s.depth * 0.16) + s.phase);   /* the curtain swings slow and wide */
		const ang = s.angAbs + sway * 0.02;
		s.sway = sway;
		s.x1 = px; s.y1 = py; s.z1 = pz;
		const L = s.len * lenF;   /* world units; treeScale and yaw apply at projection */
		const cA = Math.cos(s.azim), sA = Math.sin(s.azim);
		const mid = ang + s.bend * 0.5;
		const hM = Math.cos(mid) * L, hA = Math.cos(ang) * L * 0.52;
		s.x2 = px + hM * cA; s.z2 = pz + hM * sA; s.y2 = py + Math.sin(mid) * L;
		s.cx = px + hA * cA; s.cz = pz + hA * sA; s.cy = py + Math.sin(ang) * L * 0.52;
		s.drawAng = ang;
	}
}

/* ---------- Rendering ---------- */
function drawSky() {
	const p = skyPalette();
	const grad = ctx.createLinearGradient(0, 0, 0, groundY);
	grad.addColorStop(0, css(p.top));
	grad.addColorStop(0.62, css(p.mid));
	grad.addColorStop(1, css(p.hor));
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, W, groundY + 2);
	if (dayNight > 0.25) {
		ctx.save();
		ctx.globalAlpha = (dayNight - 0.25) / 0.75;
		ctx.drawImage(starsCanvas, 0, 0, W, H);
		ctx.restore();
	}
}

function drawCelestial(time) {
	const arcX = W * (0.5 + 0.33 * Math.cos(time * 0.02)) - Math.sin(yaw) * W * 0.028;   /* bounded parallax: orbiting never spins the sun off the sky */
	const dayY = H * 0.16 + Math.sin(time * 0.02) * H * 0.03;
	ctx.save();
	ctx.globalAlpha = 1 - dayNight;
	const sg = ctx.createRadialGradient(arcX, dayY, 4, arcX, dayY, 60);
	sg.addColorStop(0, 'rgba(255,244,190,0.95)');
	sg.addColorStop(0.35, 'rgba(255,214,110,0.55)');
	sg.addColorStop(1, 'rgba(255,200,90,0)');
	ctx.fillStyle = sg;
	ctx.beginPath(); ctx.arc(arcX, dayY, 60, 0, 7); ctx.fill();
	ctx.fillStyle = '#fff3c4';
	ctx.beginPath(); ctx.arc(arcX, dayY, 16, 0, 7); ctx.fill();
	ctx.restore();
	ctx.save();
	ctx.globalAlpha = dayNight;
	const mx = arcX;   /* the moon rises where the sun set: the tap target never moves away */
	const nightY2 = dayY;
	const mg = ctx.createRadialGradient(mx, nightY2, 3, mx, nightY2, 46);
	mg.addColorStop(0, 'rgba(235,240,255,0.9)');
	mg.addColorStop(0.4, 'rgba(200,215,245,0.35)');
	mg.addColorStop(1, 'rgba(190,205,240,0)');
	ctx.fillStyle = mg;
	ctx.beginPath(); ctx.arc(mx, nightY2, 46, 0, 7); ctx.fill();
	ctx.fillStyle = '#e8edf7';
	ctx.beginPath(); ctx.arc(mx, nightY2, 13, 0, 7); ctx.fill();
	ctx.fillStyle = 'rgba(160,170,195,0.5)';
	ctx.beginPath(); ctx.arc(mx - 4, nightY2 - 3, 2.6, 0, 7); ctx.fill();
	ctx.beginPath(); ctx.arc(mx + 5, nightY2 + 4, 1.8, 0, 7); ctx.fill();
	ctx.restore();
	return { sunX: arcX, sunY: dayY, moonX: mx, moonY: nightY2 };
}

function drawCloudShape(x, y, s, shade, alpha) {
	ctx.save();
	ctx.globalAlpha = alpha;
	for (let i = 0; i < 5; i++) {
		const ox = (i - 2) * 22 * s, oy = (i % 2 === 0 ? -7 : 3) * s, r = (26 - Math.abs(i - 2) * 5) * s;
		const grad = ctx.createRadialGradient(x + ox, y + oy, r * 0.15, x + ox, y + oy, r);
		grad.addColorStop(0, css(shade, 0.85));
		grad.addColorStop(0.7, css(shade, 0.5));
		grad.addColorStop(1, css(shade, 0));
		ctx.fillStyle = grad;
		ctx.beginPath(); ctx.arc(x + ox, y + oy, r, 0, 7); ctx.fill();
	}
	ctx.restore();
}
function drawClouds(dt) {
	const dark = precipLevel;
	const dayC = lerpC([255, 255, 255], [120, 126, 138], dark);
	const nightC = lerpC([150, 160, 185], [70, 76, 92], dark);
	const c = lerpC(dayC, nightC, dayNight);
	for (const cl of clouds) {
		cl.x += cl.v * (0.3 + windSmooth) * dt * 6;
		if (cl.x > 1.25) cl.x = -0.25;
		const cx = ((cl.x + yaw * 0.05 + 0.25) % 1.5 + 1.5) % 1.5 - 0.25;
		drawCloudShape(cx * W, cl.y * H, cl.s, c, 0.45 + dark * 0.35);
	}
	const bc = lerpC(lerpC([245, 248, 252], [128, 138, 160], dayNight), [86, 92, 106], Math.max(dark, 0.12));   /* the big cloud sleeps at night too, so it never outshines the moon */
	drawCloudShape(bigCloud.x * W, bigCloud.y * H, bigCloud.s, bc, 0.92);
	return { x: bigCloud.x * W, y: bigCloud.y * H, r: 38 * bigCloud.s };   /* hit circle hugs the visible cloud */
}

function drawWrapped(img, off) {
	let o = ((off % W) + W) % W;
	ctx.drawImage(img, -o, 0, W, H);
	if (o > 0.5) ctx.drawImage(img, W - o, 0, W, H);
}
function drawHills() {
	const w = seasonWeights();
	let gc = [0, 0, 0];
	for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) gc[k] += GRASS[SEASON_IDS[i]][k] * w[i];
	drawWrapped(hillsFar, -yaw * W * 0.07);    /* the far ridge barely turns */
	drawWrapped(hillsNear, -yaw * W * 0.14);   /* the near ridge turns more: the background follows the orbit */

	ctx.save();
	ctx.globalCompositeOperation = 'multiply';
	ctx.globalAlpha = 0.5;
	/* the seasonal tint fades in like haze: a hard top edge reads as a stripe across the sky */
	const tintTop = groundY - H * 0.22, tintFull = groundY - H * 0.10;
	const tc = lerpC(gc, [255, 255, 255], 0.35);
	const tg = ctx.createLinearGradient(0, tintTop, 0, tintFull);
	tg.addColorStop(0, css(tc, 0));
	tg.addColorStop(1, css(tc, 1));
	ctx.fillStyle = tg;
	ctx.fillRect(0, tintTop, W, H - tintTop);
	ctx.restore();
	ctx.save();
	ctx.globalCompositeOperation = 'multiply';
	ctx.globalAlpha = dayNight * 0.55;
	ctx.fillStyle = '#1c2c4c';
	ctx.fillRect(0, 0, W, H);
	ctx.restore();
}

function drawGround(time) {
	const w = seasonWeights();
	let gc = [0, 0, 0];
	for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) gc[k] += GRASS[SEASON_IDS[i]][k] * w[i];
	ctx.drawImage(groundCanvas, 0, 0, W, H);
	ctx.save();
	ctx.globalCompositeOperation = 'multiply';
	ctx.globalAlpha = 0.55;
	/* fade the tint in: a straight edge over the hill bases reads as a horizon stripe */
	const gm = ctx.createLinearGradient(0, groundY - 46, 0, groundY + 2);
	const gcc = lerpC(gc, [255, 255, 255], 0.25);
	gm.addColorStop(0, css(gcc, 0));
	gm.addColorStop(1, css(gcc, 1));
	ctx.fillStyle = gm;
	ctx.fillRect(0, groundY - 46, W, H - groundY + 46);
	ctx.restore();
	if (dayNight > 0.05) {
		ctx.save();
		ctx.globalCompositeOperation = 'multiply';
		ctx.globalAlpha = dayNight * 0.5;
		const nm = ctx.createLinearGradient(0, groundY - 46, 0, groundY + 2);
		nm.addColorStop(0, 'rgba(32,48,80,0)');
		nm.addColorStop(1, 'rgba(32,48,80,1)');
		ctx.fillStyle = nm;
		ctx.fillRect(0, groundY - 46, W, H - groundY + 46);
		ctx.restore();
	}
	/* fallen leaves */
	for (const gl of groundLeaves) {
		const gc = Math.cos(gl.rot) * DPR, gs = Math.sin(gl.rot) * DPR;
		ctx.setTransform(gc, gs, -gs, gc, gl.x * DPR, gl.y * DPR);
		ctx.globalAlpha = Math.max(0, Math.min(1, gl.life * 1.4));
		ctx.drawImage(leafSprites[gl.life < 0.55 ? 6 : gl.color], -gl.size, -gl.size, gl.size * 2, gl.size * 2);
	}
	ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
	ctx.globalAlpha = 1;	/* snow cover */
	if (snowAmount > 0.02) {
		ctx.save();
		ctx.globalAlpha = Math.min(1, snowAmount * 1.25);
		ctx.fillStyle = dayNight > 0.5 ? '#c8d2e4' : '#eef3f8';
		ctx.beginPath();
		ctx.moveTo(0, H);
		const sh = 5 + snowAmount * 20;
		for (let x = 0; x <= W; x += 12) {
			ctx.lineTo(x, groundY - sh + Math.sin(x * 0.03 + 1) * 3 + Math.sin(x * 0.008) * 5);
		}
		ctx.lineTo(W + 12, groundY - sh + Math.sin((W + 12) * 0.03 + 1) * 3 + Math.sin((W + 12) * 0.008) * 5);
		ctx.lineTo(W + 12, H);
		ctx.closePath(); ctx.fill();
		ctx.restore();
	}
	/* A small, feathered contact shadow belongs to the roots, not a flat canopy oval.
	   Draw it BEFORE the pond so neither water nor ice can ever be overpainted. */
	const rootShade = (1 - dayNight) * (1 - snowAmount * 0.65);
	if (rootShade > 0.02) {
		const rootR = (3 + 4 * ageG()) * treeScale;
		ctx.save();
		ctx.translate(treeCX, treeBase + treeScale * 0.25);
		ctx.scale(1, 0.24);
		const shade = ctx.createRadialGradient(0, 0, 0, 0, 0, rootR);
		shade.addColorStop(0, css([18, 28, 22], 0.16 * rootShade));
		shade.addColorStop(0.45, css([18, 28, 22], 0.07 * rootShade));
		shade.addColorStop(1, 'rgba(18,28,22,0)');
		ctx.fillStyle = shade;
		ctx.fillRect(-rootR, -rootR, rootR * 2, rootR * 2);
		ctx.restore();
	}
	/* the willow's pond: living water that mirrors the sky, prickles under rain and ices over in winter */
	{
		const pal = skyPalette();
		const px = pondX, py = pondY, rx = pondRX, ry = pondRY;
		const winterFreeze = currentSeason() === 3 ? smoothstep(0.05, 0.3, seasonProgress()) : 0;
		const ice = Math.max(smoothstep(0.15, 0.6, snowAmount), winterFreeze);
		const waterTop = lerpC(pal.mid, [30, 46, 68], 0.3);
		const waterBot = lerpC(pal.hor, [18, 32, 50], 0.25);
		const wg = ctx.createLinearGradient(0, py - ry, 0, py + ry);
		wg.addColorStop(0, css(lerpC(waterTop, [228, 237, 245], ice)));
		wg.addColorStop(1, css(lerpC(waterBot, [200, 214, 230], ice)));
		ctx.fillStyle = wg;
		pondPath(1); ctx.fill();
		if (ice < 0.9) {
			/* a soft shore shadow just inside the edge keeps the dip in the meadow readable */
			ctx.save();
			ctx.strokeStyle = css(lerpC(waterBot, [10, 18, 30], 0.5), (1 - ice) * 0.18);
			ctx.lineWidth = 3;
			pondPath(0.97); ctx.stroke();
			ctx.restore();
		}
		/* the bank rings the whole pond, so the edge stays whole in snow too; the far side reads darker */
		ctx.strokeStyle = css(lerpC([58, 80, 48], [30, 40, 60], dayNight * 0.55), 0.5);
		ctx.lineWidth = 1.5;
		pondPath(1); ctx.stroke();
		ctx.strokeStyle = css(lerpC([52, 74, 44], [24, 32, 52], dayNight * 0.55), 0.9);
		ctx.lineWidth = 2.5;
		ctx.beginPath();
		let bankStarted = false;
		for (let bi = 0; bi <= pondOutline.length; bi++) {
			const bp = pondOutline[bi % pondOutline.length];
			if (bp.uy < 0.22) {
				const bx = px + bp.ux * rx, by = py + bp.uy * ry;
				if (!bankStarted) { ctx.moveTo(bx, by); bankStarted = true; } else ctx.lineTo(bx, by);
			} else bankStarted = false;   /* never a chord across the water */
		}
		ctx.stroke();
		if (ice < 0.6) {
			/* ripples: short bright strokes wandering with the breeze, so the surface never sits still */
			ctx.save();
			ctx.strokeStyle = 'rgba(255,255,255,0.7)';
			ctx.lineWidth = 1;
			for (let k = 0; k < 4; k++) {
				const yy = py - ry * 0.5 + k * ry * 0.33 + Math.sin(time * 0.7 + k * 2.1) * 2.2;
				const half = rx * Math.sqrt(Math.max(0.05, 1 - Math.pow((yy - py) / ry, 2))) * 0.72;
				const x0 = px - half * 0.75 + Math.sin(time * (0.4 + k * 0.09) + k * 1.7) * half * 0.3;
				ctx.globalAlpha = (1 - ice) * (1 - dayNight * 0.5) * (0.28 + 0.17 * Math.sin(time * 0.9 + k * 2.6));
				ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x0 + half * (0.55 + 0.3 * Math.sin(time * 0.5 + k)), yy); ctx.stroke();
			}
			ctx.restore();
		}
		if (ice > 0.35) {
			/* frost creeping across the ice: pale streaks, fixed in place for the season */
			ctx.save();
			ctx.globalAlpha = ice * (0.25 + 0.1 * Math.sin(time * 0.3));
			ctx.strokeStyle = 'rgba(255,255,255,0.8)';
			ctx.lineWidth = 1;
			for (let k = 0; k < 5; k++) {
				const hy = py - ry * 0.6 + k * ry * 0.3 + Math.sin(k * 4.7) * ry * 0.08;
				const hx = px + Math.sin(k * 2.9 + 1.3) * rx * 0.4;
				const hl = rx * (0.25 + 0.2 * Math.sin(k * 1.7));
				ctx.beginPath(); ctx.moveTo(hx - hl, hy); ctx.quadraticCurveTo(hx, hy + Math.sin(k * 3.1) * 3, hx + hl, hy + Math.sin(k * 2.2) * 2); ctx.stroke();
			}
			ctx.restore();
		}
		if (rainVisibility > 0.05 && ice < 0.5) {
			/* rain prickling the surface: small drops, each with its spreading ring */
			ctx.save();
			ctx.lineWidth = 1;
			for (let k = 0; k < 9; k++) {
				const ph = (time * 1.1 + k * 0.137) % 1;
				const cyc = Math.floor(time * 1.1 + k * 0.137);
				const h1 = Math.sin(cyc * 12.9898 + k * 78.233) * 43758.5453, r1 = h1 - Math.floor(h1);
				const h2 = Math.sin(cyc * 39.346 + k * 11.135) * 24634.6345, r2 = h2 - Math.floor(h2);
				const aa = r1 * 6.2832, dd = 0.15 + r2 * 0.55;
				const dx = px + Math.cos(aa) * rx * dd, dy = py + Math.sin(aa) * ry * dd * 0.85;
				const rr = 1.5 + ph * 9;
				ctx.globalAlpha = (1 - ph) * 0.45 * rainVisibility;
				ctx.strokeStyle = 'rgba(220,232,244,0.55)';
				ctx.beginPath(); ctx.ellipse(dx, dy, rr, rr * 0.42, 0, 0, 6.2832); ctx.stroke();
				if (ph < 0.18) {
					ctx.globalAlpha = 0.7 * rainVisibility * (1 - ph / 0.18);
					ctx.fillStyle = 'rgba(230,240,250,0.8)';
					ctx.beginPath(); ctx.arc(dx, dy - 1, 0.9, 0, 6.2832); ctx.fill();
				}
			}
			ctx.restore();
		}
		if (fishT >= 0) {
			/* the summer fish: one splash - the back clearing the water, spray, two rings - then stillness */
			const ft = (time - fishT) / 1.6;
			if (ft < 1) {
				ctx.save();
				const jump = Math.sin(Math.min(1, ft * 1.2) * Math.PI);
				for (let k = 0; k < 2; k++) {
					const ph = Math.min(1, ft * 1.5 - k * 0.3);
					if (ph > 0) {
						ctx.globalAlpha = (1 - ph) * 0.5;
						ctx.strokeStyle = 'rgba(225,238,248,0.75)';
						ctx.lineWidth = 1;
						ctx.beginPath(); ctx.ellipse(fishX, fishY, 2.5 + ph * rx * 0.2, (2.5 + ph * rx * 0.2) * 0.4, 0, 0, 6.2832); ctx.stroke();
					}
				}
				if (jump > 0.04) {
					const fy2 = fishY - jump * Math.max(ry * 0.42, rx * 0.07);
					ctx.globalAlpha = Math.min(1, jump * 2.2) * (1 - dayNight * 0.35);
					ctx.fillStyle = css(lerpC([52, 74, 88], [20, 30, 48], dayNight * 0.5));
					ctx.save();
					ctx.translate(fishX + fishDir * jump * rx * 0.06, fy2);
					ctx.rotate(fishDir * (0.9 - ft * 1.8));
					ctx.beginPath(); ctx.ellipse(0, 0, rx * 0.055, ry * 0.10, 0, 0, 6.2832); ctx.fill();
					ctx.beginPath(); ctx.moveTo(0, ry * 0.09); ctx.lineTo(-fishDir * rx * 0.035, ry * 0.16); ctx.lineTo(fishDir * rx * 0.01, ry * 0.15); ctx.closePath(); ctx.fill();
					ctx.restore();
					ctx.fillStyle = 'rgba(230,242,250,0.85)';
					for (let k = 0; k < 6; k++) {
						const va = -1.2 - (k % 3) * 0.35, ha = (k - 2.5) * 0.55;
						const ddx = ha * rx * 0.045 * ft * 2, ddy = (va * ft * 2 + 4.5 * ft * ft * 4) * ry * 0.12;
						if (ddy < jump * ry * 0.3 + 2) {
							ctx.globalAlpha = Math.max(0, 0.85 - ft * 0.9);
							ctx.beginPath(); ctx.arc(fishX + ddx, fishY + ddy - jump * ry * 0.1, 1.1, 0, 6.2832); ctx.fill();
						}
					}
				}
				ctx.restore();
			}
		}
	}

}

function barkRGB(depth) {
	return lerpC([76, 64, 50], [116, 98, 74], Math.min(1, depth / 6));   /* willow bark runs greyer */
}
function barkColor(depth) {
	return css(lerpC(barkRGB(depth), [24, 32, 52], dayNight * 0.55));
}
function shadeBark(rgb, k) {
	return css(lerpC([rgb[0] * k, rgb[1] * k, rgb[2] * k], [20, 28, 48], dayNight * 0.55));
}
/* outline of a tapering curved branch; sub = number of segments */
function branchPath(s, sub, grow, circ) {
	const w1 = Math.max(0.5, s.wEff * treeScale) + grow, w2 = Math.max(0.4, s.w2Eff * treeScale) + grow;
	const lx = [], ly = [], rx = [], ry = [];
	for (let i = 0; i <= sub; i++) {
		const t = i / sub;
		segPt(s, t, _pt);
		const hw = (w1 + (w2 - w1) * t) / 2;
		lx.push(_pt.x + _pt.nx * hw); ly.push(_pt.y + _pt.ny * hw);
		rx.push(_pt.x - _pt.nx * hw); ry.push(_pt.y - _pt.ny * hw);
	}
	ctx.moveTo(lx[0], ly[0]);
	for (let i = 1; i <= sub; i++) ctx.lineTo(lx[i], ly[i]);
	for (let i = sub; i >= 0; i--) ctx.lineTo(rx[i], ry[i]);
	ctx.closePath();
	if (circ) { segPt(s, 1, _pt); ctx.moveTo(_pt.x + w2 / 2, _pt.y); ctx.arc(_pt.x, _pt.y, w2 / 2, 0, 6.2832, false); }
}
const _pt2 = { x: 0, y: 0, nx: 0, ny: 1, zv: 0 };
function drawRoot(r, grow) {
	const rootW = Math.pow(ageG(), 1.6);   /* the root flare belongs to old trees */
	const cosA = Math.cos(r.azim - yaw);   /* the root's plane turned by the orbit, like the branches */
	const sx = r.sx * rootW, sy = r.sy * rootW;
	const ex = r.ex * rootW, ey = r.ey;   /* the whole flare grows with age, not only its width */
	const cx = sx + (ex - sx) * 0.1, cy = ey - 0.2;
	const w1 = (r.w * rootW + grow * rootW) * treeScale, w2 = Math.max(0.8, r.w * 0.1 * rootW * treeScale);
	const lx = [], ly = [], rx = [], ry = [];
	const N = 8;
	for (let i = 0; i <= N; i++) {
		const t = i / N, u = 1 - t;
		const X = u * u * sx + 2 * u * t * cx + t * t * ex;
		const Y = u * u * sy + 2 * u * t * cy + t * t * ey;
		const Tx = 2 * u * (cx - sx) + 2 * t * (ex - cx), Ty = 2 * u * (cy - sy) + 2 * t * (ey - cy);
		const x = treeCX + X * cosA * treeScale, y = treeBase + Y * treeScale;
		const tx = Tx * cosA, ty = Ty;
		const l = Math.hypot(tx, ty) || 1;
		const hw = (w1 * Math.pow(1 - t, 0.85) + w2 * t) / 2;
		lx.push(x - ty / l * hw); ly.push(y + tx / l * hw);
		rx.push(x + ty / l * hw); ry.push(y - tx / l * hw);
	}
	ctx.moveTo(lx[0], ly[0]);
	for (let i = 1; i <= N; i++) ctx.lineTo(lx[i], ly[i]);
	for (let i = N; i >= 0; i--) ctx.lineTo(rx[i], ry[i]);
	ctx.closePath();
}
function drawTree() {
	const tmp = { x: 0, y: 0, nx: 0, ny: 1 };
	const bk = (d) => barkRGB(d);
	const rootW = Math.pow(ageG(), 1.6);
	/* roots: dark outline first, then the main color */
	ctx.fillStyle = shadeBark(bk(0), 0.55);
	ctx.beginPath(); for (const r of roots) drawRoot(r, 1.4); ctx.fill();
	ctx.fillStyle = barkColor(0);
	ctx.beginPath(); for (const r of roots) drawRoot(r, 0); ctx.fill();
	/* branches back-to-front by view depth: a far branch never paints over a near one */
	const order = [];
	for (let i = 0; i < segments.length; i++) {
		const s = segments[i];
		if (s.gf <= 0.02) continue;
		const mx = 0.25 * s.x1 + 0.5 * s.cx + 0.25 * s.x2, mz = 0.25 * s.z1 + 0.5 * s.cz + 0.25 * s.z2;
		order.push({ s, z: -mx * sinYaw + mz * cosYaw });
	}
	order.sort((a, b) => a.z - b.z);
	for (const o of order) {
		const s = o.s, d = s.depth, g = d < 5 ? 1.2 : 0.5;
		ctx.fillStyle = shadeBark(bk(d), 0.55);
		ctx.beginPath();
		branchPath(s, d < 3 ? 6 : (d < 6 ? 3 : 2), g, false);
		const rr = Math.max(0.4, s.w2Eff * treeScale + g) / 2;
		segPt(s, 1, tmp);
		ctx.moveTo(tmp.x + rr, tmp.y); ctx.arc(tmp.x, tmp.y, rr, 0, 6.2832, false);
		if (s.parent >= 0) {   /* seal the joint where this segment leaves its parent */
			const rr0 = Math.max(0.4, s.wEff * treeScale + g) / 2;
			segPt(s, 0, tmp);
			ctx.moveTo(tmp.x + rr0, tmp.y); ctx.arc(tmp.x, tmp.y, rr0, 0, 6.2832, false);
		}
		ctx.fill();
		const swO = Math.min(Math.max(0.5, s.wEff * treeScale + g), Math.max(0.4, s.w2Eff * treeScale + g)) * 0.92;
		if (swO > 3 && s.parent >= 0) {   /* a sharply bent thick branch pinches its outline into holes: pour the core back in */
			ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = swO; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
			ctx.beginPath();
			for (let k = 0; k <= 6; k++) { segPt(s, k / 6, tmp); if (k === 0) ctx.moveTo(tmp.x, tmp.y); else ctx.lineTo(tmp.x, tmp.y); }
			ctx.stroke();
		}
	}
	for (const o of order) {
		const s = o.s, d = s.depth;
		ctx.fillStyle = barkColor(d);
		ctx.beginPath();
		branchPath(s, d < 3 ? 6 : (d < 6 ? 3 : 2), 0, false);
		const rr = Math.max(0.4, s.w2Eff * treeScale) / 2;
		segPt(s, 1, tmp);
		ctx.moveTo(tmp.x + rr, tmp.y); ctx.arc(tmp.x, tmp.y, rr, 0, 6.2832, false);
		if (s.parent >= 0) {
			const rr0 = Math.max(0.4, s.wEff * treeScale) / 2;
			segPt(s, 0, tmp);
			ctx.moveTo(tmp.x + rr0, tmp.y); ctx.arc(tmp.x, tmp.y, rr0, 0, 6.2832, false);
		}
		ctx.fill();
		const swB = Math.min(Math.max(0.5, s.wEff * treeScale), Math.max(0.4, s.w2Eff * treeScale)) * 0.92;
		if (swB > 3 && s.parent >= 0) {
			ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = swB; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
			ctx.beginPath();
			for (let k = 0; k <= 6; k++) { segPt(s, k / 6, tmp); if (k === 0) ctx.moveTo(tmp.x, tmp.y); else ctx.lineTo(tmp.x, tmp.y); }
			ctx.stroke();
		}
	}
	/* bark relief on thick parts: dark grooves, light rim on the left, knots -
	   painted in the same back-to-front order as the bodies, so a far branch's
	   pale rim never lands on a near branch */
	ctx.lineCap = 'round';
	for (const o of order) {
		const s = o.s;
		if (!s.tex) continue;
		const wpx = s.wEff * treeScale;
		if (wpx < 3) continue;
		ctx.strokeStyle = shadeBark(bk(s.depth), 0.42);
		ctx.globalAlpha = 0.75;
		ctx.lineWidth = Math.max(0.7, wpx * 0.045);
		ctx.beginPath();
		for (const m of s.tex) {
			const t0 = m.t, t1 = Math.min(1, m.t + m.l);
			segPt(s, t0, tmp);
			const wl = (s.wEff + (s.w2Eff - s.wEff) * t0) * treeScale;
			const ax = tmp.x + tmp.nx * m.o * wl, ay = tmp.y + tmp.ny * m.o * wl;
			segPt(s, (t0 + t1) / 2, tmp);
			const wm = (s.wEff + (s.w2Eff - s.wEff) * (t0 + t1) / 2) * treeScale;
			const mx = tmp.x + tmp.nx * (m.o + (m.d ? 0.04 : -0.04)) * wm, my = tmp.y + tmp.ny * (m.o + (m.d ? 0.04 : -0.04)) * wm;
			segPt(s, t1, tmp);
			const wr = (s.wEff + (s.w2Eff - s.wEff) * t1) * treeScale;
			const bx = tmp.x + tmp.nx * m.o * wr, by = tmp.y + tmp.ny * m.o * wr;
			ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, my, bx, by);
		}
		ctx.stroke();
		/* light from the left side; keep clear of the joints so the rim never paints on a neighbour */
		ctx.globalAlpha = 0.5;
		ctx.strokeStyle = shadeBark(bk(s.depth), 1.45);
		ctx.lineWidth = Math.max(0.8, wpx * 0.12);
		ctx.beginPath();
		for (let k = 0; k <= 6; k++) {
			const tk = 0.08 + (k / 6) * 0.84;
			segPt(s, tk, tmp);
			const w = (s.wEff + (s.w2Eff - s.wEff) * tk) * treeScale;
			const px = tmp.x + tmp.nx * w * 0.3, py = tmp.y + tmp.ny * w * 0.3;
			if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
		}
		ctx.stroke();
		/* shadow on the right side */
		ctx.globalAlpha = 0.4;
		ctx.strokeStyle = shadeBark(bk(s.depth), 0.35);
		ctx.beginPath();
		for (let k = 0; k <= 6; k++) {
			const tk = 0.08 + (k / 6) * 0.84;
			segPt(s, tk, tmp);
			const w = (s.wEff + (s.w2Eff - s.wEff) * tk) * treeScale;
			const px = tmp.x - tmp.nx * w * 0.33, py = tmp.y - tmp.ny * w * 0.33;
			if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
		}
		ctx.stroke();
		ctx.globalAlpha = 1;
	}
	/* roots: grooves and light */
	if (rootW > 0.15) {
	ctx.globalAlpha = 0.5 * rootW;
	ctx.strokeStyle = shadeBark(bk(0), 1.4);
	ctx.lineWidth = Math.max(1, treeScale * 0.35);
	ctx.beginPath();
	for (const r of roots) {
		const cosA = Math.cos(r.azim - yaw);
		const sx = treeCX + r.sx * cosA * treeScale, sy = treeBase + r.sy * treeScale;
		const ex = treeCX + r.ex * cosA * treeScale, ey = treeBase + r.ey * treeScale;
		ctx.moveTo(sx, sy + 2 * treeScale);
		ctx.quadraticCurveTo(sx + (ex - sx) * 0.1, ey - 0.2 * treeScale, sx + (ex - sx) * 0.7, ey - 0.6 * treeScale);
	}
	ctx.stroke();
	ctx.globalAlpha = 1;
	}
	/* hollow: a scar of great age, appears only in old trees */
	if (smoothstep(0.75, 0.95, ageG()) > 0.01) {
	ctx.globalAlpha = smoothstep(0.75, 0.95, ageG());
	const hs = segments[1];
	segPt(hs, 0.45, tmp);
	const hx = tmp.x + tmp.nx * hs.w * treeScale * 0.12, hy = tmp.y + tmp.ny * hs.w * treeScale * 0.12;
	const hr = treeScale;
	ctx.save();
	ctx.translate(hx, hy);
	ctx.rotate(hs.drawAng + hs.bend * 0.5 + Math.PI / 2);
	ctx.fillStyle = shadeBark(bk(0), 0.7);
	ctx.beginPath(); ctx.ellipse(0, 0, 2.5 * hr, 4.6 * hr, 0, 0, 6.2832); ctx.fill();
	const g = ctx.createRadialGradient(0.2 * hr, 0.8 * hr, 0.3 * hr, 0, 0.5 * hr, 3.4 * hr);
	g.addColorStop(0, dayNight > 0.5 ? '#000' : '#050302');
	g.addColorStop(0.55, dayNight > 0.5 ? '#06090f' : '#1a0f08');
	g.addColorStop(1, dayNight > 0.5 ? '#10151f' : '#33200f');
	ctx.fillStyle = g;
	ctx.beginPath();
	ctx.moveTo(0, -3.9 * hr);
	ctx.bezierCurveTo(1.9 * hr, -2.6 * hr, 2.1 * hr, 1.6 * hr, 0.3 * hr, 3.8 * hr);
	ctx.bezierCurveTo(-1.8 * hr, 2.2 * hr, -1.9 * hr, -2.4 * hr, 0, -3.9 * hr);
	ctx.fill();
	ctx.strokeStyle = shadeBark(bk(1), 1.35);
	ctx.globalAlpha = 0.55;
	ctx.lineWidth = Math.max(1, 0.35 * hr);
	ctx.beginPath(); ctx.arc(0, 0, 3.0 * hr, Math.PI * 1.05, Math.PI * 1.9); ctx.stroke();
	ctx.restore();
	ctx.globalAlpha = 1;
	}
	/* moss: green patches on the trunk's shadow side in spring/summer, thicker with age */
	const w = seasonWeights();
	const mossA = Math.min(1, w[0] * 0.7 + w[1] + w[2] * 0.5) * smoothstep(0.2, 0.55, ageG());
	if (mossA > 0.05) {
		ctx.fillStyle = css(lerpC([86, 124, 56], [20, 40, 40], dayNight * 0.6), 0.55 * mossA);
		for (const m of mossSpots) {
			const s = segments[m.t < 0.5 ? 0 : 1];
			segPt(s, (m.t % 0.5) * 2 * 0.9 + 0.05, tmp);
			const ww = s.wEff * treeScale;
			ctx.beginPath(); ctx.ellipse(tmp.x + tmp.nx * m.o * ww * 1.4, tmp.y + tmp.ny * m.o * ww * 1.4, m.r * treeScale * 0.9, m.r * treeScale * 0.55, 0.6, 0, 6.2832); ctx.fill();
		}
	}
	/* snow caps: along the top side of branches, drawn above all branches */
	if (snowAmount > 0.03) {
		ctx.strokeStyle = dayNight > 0.5 ? 'rgba(206,216,234,0.95)' : 'rgba(244,249,252,0.95)';
		ctx.lineCap = 'round'; ctx.lineJoin = 'round';
		const cov = 0.3 + snowAmount * 0.7;
		const a0 = (1 - cov) / 2;
		for (let i = 3; i < segments.length; i++) {
			const s = segments[i];
			if (s.gf < 0.3) continue;   /* no snow on branches that have not grown yet */
			const wpx = (s.wEff + s.w2Eff) / 2 * treeScale;
			segPt(s, 0, tmp); segPt(s, 1, _pt2);
			const hdx = Math.abs(_pt2.x - tmp.x), hl = Math.hypot(hdx, _pt2.y - tmp.y) || 1;
			const hz = hdx / hl;
			if (s.depth < 4 && hz < 0.3) continue;   /* snow does not hold on nearly vertical branches */
			ctx.lineWidth = Math.min(Math.max(1.1, wpx * 0.3), 4.2) * (0.4 + snowAmount * 0.6) * (0.55 + 0.45 * hz);
			ctx.beginPath();
			for (let k = 0; k <= 3; k++) {
				const t = a0 + (1 - 2 * a0) * (k / 3);
				segPt(s, t, tmp);
				const w = (s.wEff + (s.w2Eff - s.wEff) * t) * treeScale;
				let nx = tmp.nx, ny = tmp.ny;
				if (ny > 0) { nx = -nx; ny = -ny; }
				const off = w * 0.4 + ctx.lineWidth * 0.3;
				if (k === 0) ctx.moveTo(tmp.x + nx * off, tmp.y + ny * off); else ctx.lineTo(tmp.x + nx * off, tmp.y + ny * off);
			}
			ctx.stroke();
		}
		/* Branch snow caps already follow the roots. The snowy ground supplies
		   the base cover; no separate oval decal is needed here. */
	}
}

/* Continuous leaf colour weights. Each boundary has matching end points. */
function leafColors(leaf, t) {
 const green = leaf.hue < 0.5 ? 1 : 2;
 const autumn = leaf.hue < 0.4 ? 3 : leaf.hue < 0.75 ? 4 : 5;
 if (t < 1) return [0, green, smoothstep(0.68, 1, t)];
 if (t < 2) return [green, green, 0];
 if (t < 3) {
  const progress = t - 2;
  const color = smoothstep(leaf.colDelay * 0.65, leaf.colDelay * 0.65 + 0.42, progress);
  if (leaf.winterKeep && progress > 0.80) return [autumn, 6, smoothstep(0.80, 1, progress)];
  return [green, autumn, color];
 }
 return [6, 6, 0];
}

/* Cache gradual colour blends so each leaf still needs only one draw call. */
const blendedLeaves = [];
function blendedLeaf(a, b, mix, rotation) {
 const level = Math.round(mix * 16);
 if (level === 0 || a === b) return rotSprites[a][rotation];
 if (level === 16) return rotSprites[b][rotation];
 const key = (((a * 7 + b) * 17 + level) * ROT_STEPS + rotation);
 if (blendedLeaves[key]) return blendedLeaves[key];
 const image = document.createElement('canvas'); image.width = image.height = 40;
 const g = image.getContext('2d');
 g.globalAlpha = 1 - level / 16; g.drawImage(rotSprites[a][rotation], 0, 0);
 g.globalCompositeOperation = 'lighter'; g.globalAlpha = level / 16;
 g.drawImage(rotSprites[b][rotation], 0, 0);
 blendedLeaves[key] = image; return image;
}

let leafSkip = 1, slowAcc = 0, slowN = 0, adaptOff = false;
function drawLeaves(time, mode) {
	
	const t4 = ((yearT % 4) + 4) % 4;
	const sp = seasonProgress();
	const nightDim = 1 - dayNight * 0.45;
	let li = -1;
	ctx.globalAlpha = nightDim;
	const staged = [];
	for (const leaf of leaves) {
		li++;
		if (leaf.state === 'gone') continue;
		if (mode === 'static' && leaf.state === 'falling') continue;
		if (mode === 'falling' && leaf.state !== 'falling') continue;
		if (leafSkip > 1 && leaf.state !== 'falling' && (li % leafSkip) !== 0) continue;
		if (leaf.state === 'falling') {
            ctx.globalAlpha = nightDim;
			/* Reuse the rotated sprites in flight too: no canvas transform per leaf. */
			let ri = Math.round(leaf.frot * (ROT_STEPS / 6.2832)) % ROT_STEPS;
			if (ri < 0) ri += ROT_STEPS;
			const color = leaf.hue < 0.4 ? 3 : leaf.hue < 0.75 ? 4 : 5;
			ctx.drawImage(rotSprites[color][ri], leaf.fx - leaf.size, leaf.fy - leaf.size, leaf.size * 2, leaf.size * 2);
			continue;
		}
		const s = segments[leaf.seg];
		/* leaves appear with their branch; sapling foliage starts at the tip in the
		   first years and fades as the outer crown takes over */
		const ageLeaf = leaf.young
			? smoothstep(0.03, 0.16, s.gf) * (1 - smoothstep(0.3, 0.6, ageG()))
			: smoothstep(0.18, 0.45, s.gf);
		if (ageLeaf <= 0.001) continue;
		segPt(s, leaf.t, _pt);
		const x = _pt.x + _pt.nx * leaf.off * treeScale;
		const y = _pt.y + _pt.ny * leaf.off * treeScale;
		/* Buds emerge from invisible points after winter. Retained dry leaves
           fade before the spring boundary, so no full crown appears in one frame. */
        let scale = 1, opacity = 1;
        if (t4 < 1) {
            scale = smoothstep(leaf.grow / 1.6, (leaf.grow + 0.5) / 1.6, sp);
            const bud = smoothstep(0, 0.12 + leaf.grow * 0.12, sp) * (1 - smoothstep(0.02, 0.22, scale));
            if (bud > 0.001) {
                ctx.globalAlpha = nightDim * bud;
                ctx.fillStyle = css(lerpC([120,90,60], [150,200,110], sp), 0.9);
                ctx.beginPath(); ctx.arc(x, y, 1.3, 0, 7); ctx.fill();
            }
            if (scale <= 0.001) continue;
        } else if (t4 >= 3) {
            if (!leaf.winterKeep) continue;
            scale = 0.55;
            opacity = 1 - smoothstep(0.72, 1, sp);
        } else if (t4 >= 2 && leaf.winterKeep) {
            scale = 1 - 0.45 * smoothstep(0.80, 1, sp);
        }

		const flut = Math.sin(time * (2.2 + leaf.hue) + leaf.phase) * (0.12 + windSmooth * 0.55);
		/* strand leaves lie along their twig, tips pointing down the curtain */
		const rotB = s.depth >= 3 ? s.drawAng + s.bend * leaf.t + Math.PI / 2 + (leaf.rot0 - Math.PI) * 0.4 : leaf.rot0;
		let ri = Math.round((rotB + flut) * (ROT_STEPS / 6.2832)) % ROT_STEPS;
		if (ri < 0) ri += ROT_STEPS;
		const sz = leaf.size * scale * ageLeaf * (leafSkip > 1 ? 0.95 * Math.sqrt(leafSkip) : 1) * 1.25;
		staged.push({ x, y, z: _pt.zv, sz, ri, opacity, c: leafColors(leaf, t4) });
	}
	/* back-to-front, so far foliage never covers the branches and leaves in front */
	staged.sort((a, b) => a.z - b.z);
	for (const st of staged) {
		ctx.globalAlpha = nightDim * st.opacity;
		ctx.drawImage(blendedLeaf(st.c[0], st.c[1], st.c[2], st.ri), st.x - st.sz, st.y - st.sz, st.sz * 2, st.sz * 2);
	}
	ctx.globalAlpha = 1;
}

/* ---------- Precipitation and effects ---------- */
function drawRain(dt) {
	if (rainVisibility <= 0.002) return;
	const slant = windSmooth * 260;
	ctx.strokeStyle = 'rgba(190,205,228,0.55)';
	ctx.lineWidth = 1;
	ctx.beginPath();
	const n = Math.ceil(rainDrops.length * rainVisibility);
 ctx.save(); ctx.globalAlpha = Math.min(1, rainVisibility * 2);
	for (let i = 0; i < n; i++) {
		const d = rainDrops[i];
		ctx.moveTo(d.x, d.y);
		ctx.lineTo(d.x - slant * 0.02 * d.len * 0.1, d.y + d.len);
	}
	ctx.stroke();
 ctx.restore();
	for (let i = 0; i < n; i++) {
		const d = rainDrops[i];
		d.y += d.v * dt * (0.6 + precipLevel * 0.6);
		d.x -= slant * dt;
		if (d.y > groundY + rand(0, 20)) { d.y = rand(-40, -5); d.x = rand(-50, W + 80); }
	}
	/* light haze near the ground */
	const mg = ctx.createLinearGradient(0, groundY - 30, 0, groundY + 10);
	mg.addColorStop(0, 'rgba(180,195,210,0)');
	mg.addColorStop(1, 'rgba(180,195,210,' + (0.18 * rainVisibility).toFixed(2) + ')');
	ctx.fillStyle = mg;
	ctx.fillRect(0, groundY - 30, W, 44);
}

let snowDrawn = 0;
function drawSnow(dt, time) {
	const snowing = snowVisibility > 0.002;
	if (!snowing) return;
	snowDrawn++;
	ctx.save(); ctx.globalAlpha = Math.min(1, snowVisibility * 2);
 ctx.fillStyle = dayNight > 0.5 ? 'rgba(225,232,245,0.9)' : 'rgba(255,255,255,0.92)';
	const n = Math.ceil(snowFlakes.length * snowVisibility);
	for (let i = 0; i < n; i++) {
		const f = snowFlakes[i];
		f.y += f.v * dt * (0.7 + precipLevel * 0.5);
		f.x += Math.sin(time * 1.3 + f.ph) * 14 * dt + windSmooth * 40 * dt;
		if (f.y > groundY - snowAmount * 18) { f.y = rand(-30, -5); f.x = rand(-20, W + 20); }
		ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.fill();
	}
ctx.restore();
}

let petalFade = 0;					  /* smooth visibility of the blossom drift */
function drawPetals(dt, time) {
	/* petals drift only in mid and late spring; they ease in and out with the season */
	const t4 = ((yearT % 4) + 4) % 4;
	let target = 0;
	if (t4 < 1) {
		const sp = seasonProgress();
		target = Math.min(Math.min(1, Math.max(0, (sp - 0.22) / 0.13)), Math.min(1, Math.max(0, (1 - sp) / 0.12)));
	}
	petalFade += (target - petalFade) * Math.min(1, dt * 1.6);
	if (petalFade <= 0.02) return;
	const rainCut = precipMode === 'rain' || precipMode === 'storm' ? 1 - precipLevel * 0.55 : 1;
	const n = Math.ceil(petals.length * petalFade * rainCut);
	const dim = (1 - dayNight * 0.45) * 0.96;
	for (let i = 0; i < petals.length; i++) {
		const p = petals[i];
		if (p.land > 0) {
			/* a landed petal rests on the ground for a moment, then a fresh one starts from the crown */
			p.land -= dt;
			if (p.land <= 0 || petalFade < 0.2) { Object.assign(p, newPetal(false)); continue; }
			ctx.globalAlpha = Math.min(1, p.land) * 0.55 * dim;
			ctx.save();
			ctx.translate(p.x, p.y);
			ctx.drawImage(petalSprites[p.c], -p.size, -p.size * 0.5, p.size * 2, p.size);
			ctx.restore();
			continue;
		}
		if (i >= n) continue;
		p.rot += p.spin * dt;
		p.y += p.v * dt * (0.8 + 0.4 * Math.sin(time * 1.1 + p.ph));
		p.x += (Math.sin(time * 0.9 + p.ph) * p.swayAmp + windSmooth * 30) * dt;
		if (p.x > W + 20) p.x = -10; else if (p.x < -20) p.x = W + 10;
		if (p.y >= groundY - 2 - snowAmount * 16) { p.land = rand(0.8, 1.8); p.y = groundY - 2 - snowAmount * 16; }
		const tumble = 0.7 + 0.3 * Math.sin(time * 2.3 + p.ph * 2);
		ctx.globalAlpha = dim;
		ctx.save();
		ctx.translate(p.x, p.y);
		ctx.rotate(p.rot);
		ctx.drawImage(petalSprites[p.c], -p.size, -p.size * tumble, p.size * 2, p.size * 2 * tumble);
		ctx.restore();
	}
	ctx.globalAlpha = 1;
}

function drawFireflies(time) {
	const summerGlow = seasonWeights()[1] * smoothstep(0.5, 0.8, dayNight);
 if (summerGlow < 0.002) return;
	for (const f of fireflies) {
		const glow = Math.max(0, Math.sin(time * f.sp * 2 + f.ph));
		if (glow < 0.25) continue;
		f.x += Math.sin(time * 0.4 + f.ph) * 0.25;
		f.y += Math.cos(time * 0.33 + f.ph * 2) * 0.18;
		ctx.save();
		ctx.globalAlpha = glow * 0.85 * summerGlow;
		const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 6);
		g.addColorStop(0, 'rgba(220,255,150,0.9)');
		g.addColorStop(1, 'rgba(220,255,150,0)');
		ctx.fillStyle = g;
		ctx.beginPath(); ctx.arc(f.x, f.y, 6, 0, 7); ctx.fill();
		ctx.restore();
	}
}

function drawFlowers(time) {
	const s = currentSeason(), sp = seasonProgress();
	const growth = s === 0 ? Math.min(1, Math.max(0, (sp - 0.12) / 0.62)) : s === 1 ? 1 : s === 2 ? Math.max(0, 1 - sp / 0.20) : 0;
	const snowCut = 1 - Math.min(1, snowAmount * 4);
	if (growth <= 0.01 || snowCut <= 0) return;
	ctx.save();
	for (let n = 0; n < flowers.length; n++) {
		const f = flowers[n];
		const stagger = (f.ph / 6.28) * 0.25;
		const scale = Math.min(1, Math.max(0, (growth - stagger) / (1 - stagger))) * snowCut;
		if (scale <= 0.01) continue;
		const sway = Math.sin(time * 1.8 + f.ph) * windSmooth * 2;
		const x = f.x + sway, y = f.y - (4 + f.s * 2) * scale, r = f.s * scale;
		ctx.globalAlpha = (1 - dayNight * 0.55) * Math.min(1, scale * 2);
		ctx.strokeStyle = '#527e35'; ctx.lineWidth = 1;
		ctx.beginPath(); ctx.moveTo(f.x, f.y + 2); ctx.quadraticCurveTo(f.x - sway, y + 4, x, y); ctx.stroke();
		const seedHead = n % 4 === 0 && (s === 1 || s === 2);
		const seedProgress = seedHead ? (s === 2 ? 1 : smoothstep(0.22 + stagger, 0.72 + stagger, sp)) : 0;
		if (!seedHead || seedProgress < 1) {
            const flowerAlpha = ctx.globalAlpha; ctx.globalAlpha *= 1 - smoothstep(0.35, 0.65, seedProgress);
			ctx.fillStyle = n % 4 === 0 ? '#f4d33a' : css(f.c);
			for (let p = 0; p < (n % 4 === 0 ? 9 : 5); p++) {
				const a = p / (n % 4 === 0 ? 9 : 5) * Math.PI * 2 + f.ph;
				ctx.beginPath(); ctx.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.75, 0, 7); ctx.fill();
			}
			ctx.fillStyle = '#f8d348'; ctx.beginPath(); ctx.arc(x, y, r * 0.6, 0, 7); ctx.fill();
            ctx.globalAlpha = flowerAlpha;
		}
        if (seedHead && seedProgress > 0.35) {
			/* Ripened dandelions release tiny parachutes into a gust. */
			ctx.strokeStyle = 'rgba(250,250,238,0.85)'; ctx.lineWidth = 0.65;
			for (let p = 0; p < 10; p++) {
				const a = p / 10 * Math.PI * 2;
				const drift = Math.max(0, seedProgress - 0.67 - p * 0.025) * 120;
				const dx = drift * (0.35 + windSmooth), dy = -drift * 0.32;
				ctx.globalAlpha = (1 - dayNight * 0.55) * Math.max(0, 1 - drift / 55) * smoothstep(0.35, 0.65, seedProgress) * (1 - smoothstep(0.85, 1, seedProgress));
				const tx = x + Math.cos(a) * r * 1.8 + dx, ty = y + Math.sin(a) * r * 1.8 + dy;
				ctx.beginPath(); ctx.moveTo(x + dx, y + dy); ctx.lineTo(tx, ty); ctx.stroke();
				ctx.beginPath(); ctx.arc(tx, ty, 0.7, 0, 7); ctx.stroke();
			}
		}
	}
	ctx.restore();
}
function drawBirds(dt, time) {
	const birdVisibility = (1 - seasonWeights()[3]) * (1 - smoothstep(0.30, 0.55, dayNight)) * (1 - smoothstep(0.30, 0.65, precipLevel));
 ctx.save(); ctx.globalAlpha = birdVisibility;
	birdTimer -= dt;
	if (birdTimer <= 0 && birdsFly.length < 3 && birdVisibility > 0.2) {
		birdsFly.push({ x: -30, y: rand(H * 0.15, H * 0.4), vx: rand(40, 70), ph: rand(0, 6.28) });
		birdTimer = rand(9, 22);
	}
	ctx.strokeStyle = dayNight > 0.2 ? '#2a3040' : '#20262e';
	ctx.lineWidth = 1.6;
	ctx.lineCap = 'round';
	for (let i = birdsFly.length - 1; i >= 0; i--) {
		const b = birdsFly[i];
		b.x += b.vx * dt * (0.6 + windSmooth * 0.5);
		if (b.x > W + 40) { birdsFly.splice(i, 1); continue; }
		const flap = Math.sin(time * 9 + b.ph) * 5;
		ctx.beginPath();
		ctx.moveTo(b.x - 7, b.y + flap * 0.4);
		ctx.quadraticCurveTo(b.x - 3, b.y - 3 - flap, b.x, b.y);
		ctx.quadraticCurveTo(b.x + 3, b.y - 3 - flap, b.x + 7, b.y + flap * 0.4);
		ctx.stroke();
	}
 ctx.restore();
}
let lightningCount = 0, boltPts = [], boltBranches = [];
function makeBolt() {
	let x = W * rand(0.15, 0.85), y = H * 0.06;
	boltPts = [[x, y]]; boltBranches = [];
	const endY = groundY + 4;
	while (y < endY) {
		y += rand(H * 0.025, H * 0.06);
		x += rand(-W * 0.035, W * 0.035);
		boltPts.push([x, Math.min(y, endY)]);
		if (rng() < 0.28) {
			const br = [[x, y]];
			let bx = x, by = y;
			const dir = rng() < 0.5 ? -1 : 1;
			for (let k = 0; k < 3; k++) { bx += dir * rand(W * 0.01, W * 0.04); by += rand(H * 0.02, H * 0.05); br.push([bx, by]); }
			boltBranches.push(br);
		}
	}
}
function drawLightning() {
	if (lightning <= 0.01) return;
	ctx.save();
	if (lightning > 0.35 && boltPts.length) {
		const a = Math.min(1, (lightning - 0.35) / 0.4);
		ctx.lineJoin = 'round'; ctx.lineCap = 'round';
		const stroke = (pts, w, col, al) => {
			ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
			for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
			ctx.lineWidth = w; ctx.strokeStyle = col; ctx.globalAlpha = al; ctx.stroke();
		};
		stroke(boltPts, 9, 'rgba(170,200,255,1)', a * 0.35);
		for (const br of boltBranches) stroke(br, 5, 'rgba(170,200,255,1)', a * 0.3);
		stroke(boltPts, 2.6, '#ffffff', a);
		for (const br of boltBranches) stroke(br, 1.4, '#ffffff', a * 0.9);
	}
	ctx.globalAlpha = Math.min(0.6, lightning * 0.65);
	ctx.fillStyle = '#e6eeff';
	ctx.fillRect(0, 0, W, H);
	ctx.restore();
}

/* ---------- World update ---------- */
let cloudHit = { x: 0, y: 0, r: 60 };
let celHit = { sunX: 0, sunY: 0, moonX: 0, moonY: 0 };
const chips = Array.from(document.querySelectorAll('.chip'));
let shownSeason = -1;

function updateWorld(dt, time) {
	/* holding a finger on the ground pours time into the roots; two fingers take it back */
	if (growHold !== 0) {
		growHeld += dt;
		const rate = Math.min(26, 6 + growHeld * 5) * growHold;   /* the longer the hold, the faster the years flow */
		ageIntro = false;
		ageYears = Math.max(1, Math.min(200, ageYears + rate * dt));
		ageTarget = ageYears;
		if (ageYears <= 1 || ageYears >= 200) growHold = 0;
	} else growHeld = 0;
	/* tree age eases toward its target; the intro grows the tree up */
	if (ageIntro && ageTarget - ageYears < 2) ageIntro = false;
	const dAge = ageTarget - ageYears;
	if (dAge < -0.005 || ageYears < lastAgeYears - 0.5) {
		/* growing younger: the old crown's flying and fallen leaves do not
		   belong around the sapling it is becoming */
		for (const leaf of leaves) if (leaf.state === 'falling') leaf.state = 'attached';
		groundLeaves.length = 0;
		updateTree(0);   /* regrow the geometry now, before this frame's autumn check reads gf */
	}
	if (Math.abs(dAge) > 0.005) ageYears += dAge * Math.min(1, dt * (ageIntro ? 1.4 : 3.5));
	else ageYears = ageTarget;
	lastAgeYears = ageYears;
	if (!orbitDrag && yawVel !== 0) {
		yaw += yawVel;
		yawVel *= Math.pow(0.12, dt);   /* a gentle spin that quickly settles */
		if (Math.abs(yawVel) < 0.0004) yawVel = 0;
	}
	/* the seasonal cycle */
	yearT = (yearT + dt * speedMul / SEASON_SECONDS) % 4;
	const seasonNow = currentSeason();
	if (seasonNow !== previousSeason) {
		previousSeason = seasonNow;
		if (seasonNow === 3) {
			/* A winter begins bare, then fresh snowfall gradually settles. */
			if (paramWeather !== 'clear') {
				precipMode = 'snow'; autoWeatherOff = true; precipModeUntil = 35;
			}
			autoWeatherTimer = 12;
		} else if (precipMode === 'snow') {
			/* Spring keeps the settled cover, but stops the winter snowfall. */
			precipMode = 'off'; autoWeatherOff = false; autoWeatherTimer = 16;
		}
		if (seasonNow === 0) {
			for (const leaf of leaves) leaf.state = 'attached';
		}
	}
	/* day/night */
	if (autoDN) {
		dnTimer -= dt;
		if (dnTimer <= 0) {
			dayNightTarget = dayNightTarget > 0.5 ? 0 : 1;
			dnTimer = dayNightTarget > 0.5 ? rand(26, 36) : rand(52, 70);
		}
	}
	const dnSpeed = dt / 5;
	if (dayNight < dayNightTarget) dayNight = Math.min(dayNightTarget, dayNight + dnSpeed);
	else if (dayNight > dayNightTarget) dayNight = Math.max(dayNightTarget, dayNight - dnSpeed);
	/* wind: slow base + gusts */
	gustTimer -= dt;
	if (gustTimer <= 0) {
		gustTarget = rand(0, 1);
		gustTimer = rand(5, 14);
	}
	gust += (gustTarget - gust) * Math.min(1, dt * 0.8);
	const target = 0.18 + gust * 0.82;
	windSmooth += (target - windSmooth) * Math.min(1, dt * 1.2);
	Sound.setWind(windSmooth * (0.5 + precipLevel * 0.5));
	/* auto weather: downpours in spring and autumn, snowfalls in winter, rare in summer */
	autoWeatherTimer -= dt;
	if (autoWeatherTimer <= 0 && precipMode === 'off') {
		const s = currentSeason();
		if (s === 3) { precipMode = 'snow'; autoWeatherTimer = rand(18, 34); }
		else if (s === 0 || s === 2) { precipMode = rng() < 0.3 ? 'storm' : 'rain'; autoWeatherTimer = rand(12, 24); }
		else if (rng() < 0.45) { precipMode = 'rain'; autoWeatherTimer = rand(10, 18); }
		else autoWeatherTimer = rand(14, 26);
		precipModeUntil = autoWeatherTimer;
		autoWeatherOff = true;
	}
	if (autoWeatherOff) {
		precipModeUntil -= dt;
		if (precipModeUntil <= 0) {
			precipMode = 'off';
			autoWeatherOff = false;
			autoWeatherTimer = rand(25, 50);
		}
	}
	/* smooth precipitation strength */
	const pTarget = precipMode === 'off' ? 0 : (precipMode === 'storm' ? 1 : 0.7);
	precipLevel += (pTarget - precipLevel) * Math.min(1, dt * 0.8);
 rainVisibility += (((precipMode === 'rain' || precipMode === 'storm') ? precipLevel : 0) - rainVisibility) * Math.min(1, dt * 0.65);
 snowVisibility += ((precipMode === 'snow' ? precipLevel : 0) - snowVisibility) * Math.min(1, dt * 0.65);
	Sound.setRain(precipMode === 'rain' || precipMode === 'storm' ? precipLevel : 0);
	/* Seasonal settling continues even between snow showers. At the year boundary
	   the old cover remains and melts; only a manual season jump clears it. */
	if (seasonNow === 3) {
		const winterTarget = Math.min(1, seasonProgress() / 0.72);
		snowAmount += (winterTarget - snowAmount) * Math.min(1, dt * 0.7);
	} else if (seasonNow === 0) {
		snowAmount = Math.max(0, snowAmount - dt * speedMul / (SEASON_SECONDS * 0.30));
	} else snowAmount = Math.max(0, snowAmount - dt * 0.10);
	/* the pond fish keeps still water unpredictable: one rare splash in summer, then gone again */
	if (fishT < 0 && seasonNow === 1 && snowAmount < 0.2 && time >= fishNext) {
		fishT = time;
		fishDir = rand(0, 1) < 0.5 ? -1 : 1;
		const fa = rand(0, 6.2832), fd = rand(0.12, 0.5);
		fishX = pondX + Math.cos(fa) * pondRX * fd; fishY = pondY + Math.sin(fa) * pondRY * fd * 0.85;
	} else if (fishT >= 0 && time - fishT > 1.6) {
		fishT = -1; fishNext = time + rand(16, 34);
	}
	/* storm: flashes and thunder */
	if (precipMode === 'storm' && prevPrecipMode !== 'storm') lightningTimer = Math.min(lightningTimer, rand(3, 7));
	prevPrecipMode = precipMode;
	if (precipMode === 'storm' && precipLevel > 0.5) {
		lightningTimer -= dt;
		if (lightningTimer <= 0) {
			lightning = 1; lightningCount++; makeBolt();
			lightningTimer = rand(6, 18);
			setTimeout(() => Sound.thunder(), rand(600, 1600));
		}
	}
	lightning = Math.max(0, lightning - dt * 2.2);
	/* leaf fall in autumn */
	const t4 = ((yearT % 4) + 4) % 4;
	const sp = seasonProgress();
	if (t4 >= 2 && t4 < 3) {
		for (const leaf of leaves) {
			if (leaf.state === 'attached' && !leaf.winterKeep && sp > leaf.fallAt) {
				const s = segments[leaf.seg];
				/* only leaves the crown actually shows may fall: a sapling sheds
				   its few real leaves, not the big tree it will one day be */
				const vis = leaf.young
					? smoothstep(0.03, 0.16, s.gf) * (1 - smoothstep(0.3, 0.6, ageG()))
					: smoothstep(0.18, 0.45, s.gf);
				if (vis <= 0.05) continue;
				leaf.state = 'falling';
				segPt(s, leaf.t, _pt);
				leaf.fx = _pt.x + _pt.nx * leaf.off * treeScale;
				leaf.fy = _pt.y + _pt.ny * leaf.off * treeScale;
				leaf.fvx = rand(-8, 8); leaf.fvy = rand(4, 16);
				leaf.frot = rand(0, 6.28); leaf.fspin = rand(-3, 3);
			}
		}
	}
	if (t4 < 2) {
		/* in spring and summer all leaves stay in place */
		for (const leaf of leaves) if (leaf.state !== 'attached') leaf.state = 'attached';
	}
	/* flight of falling leaves */
	for (const leaf of leaves) {
		if (leaf.state !== 'falling') continue;
		leaf.fvy = Math.min(70, leaf.fvy + 55 * dt);
		leaf.fx += (leaf.fvx + windSmooth * 55 + Math.sin(time * 3 + leaf.phase) * 22) * dt;
		leaf.fy += leaf.fvy * dt * (0.6 + 0.4 * Math.sin(time * 2.2 + leaf.phase));
		leaf.frot += leaf.fspin * dt;
		if (leaf.fy >= groundY - 2 - snowAmount * 16) {
			leaf.state = 'gone';
			if (groundLeaves.length < 700) {
				const gy = groundY + 4 + Math.pow(rng(), 1.4) * (H - groundY) * 0.5;
				groundLeaves.push({ x: leaf.fx + rand(-30, 30) * (0.5 + (gy - groundY) / 60), y: gy, rot: rand(0, 6.28), size: leaf.size * (0.8 + (gy - groundY) / (H - groundY) * 1.1), color: [3, 4, 4, 5, 6][Math.floor(rng() * 5)], life: 1 });
			}
		}
	}
	/* dry leaves on the ground melt and rot away */
	for (let i = groundLeaves.length - 1; i >= 0; i--) {
		if (!(t4 >= 2 && t4 < 3)) groundLeaves[i].life -= dt / (t4 >= 3 ? 30 : 20);
		if (groundLeaves[i].life <= 0) groundLeaves.splice(i, 1);
	}

	/* highlight of the active season */
	const cs = currentSeason();
	if (cs !== shownSeason) {
		shownSeason = cs;
		chips.forEach(c => { c.classList.toggle('active', +c.dataset.season === cs); c.setAttribute('aria-pressed', String(+c.dataset.season === cs)); });
	}
}
let precipModeUntil = 0, autoWeatherOff = false;
if (currentSeason() === 3 && !paramWeather) { precipMode = 'snow'; autoWeatherOff = true; precipModeUntil = 35; }

/* ---------- First-launch coach: a quiet pulse where a held finger grows the tree ---------- */
let coached = false;
function drawCoachPulse(time) {
	const px = W / 2, py = groundY - H * 0.012;
	ctx.save();
	for (let k = 0; k < 2; k++) {
		const ph = (time * 0.55 + k * 0.5) % 1;
		const r = 24 + ph * 72;
		ctx.globalAlpha = (1 - ph) * 0.55;
		ctx.strokeStyle = '#ffe9a8';
		ctx.lineWidth = 3 - ph * 1.6;
		ctx.beginPath(); ctx.ellipse(px, py, r, r * 0.32, 0, 0, 7); ctx.stroke();
	}
	ctx.restore();
}

/* ---------- Main loop ---------- */
let lastT = 0;
const off = {};
function frame(ms) {
	if (document.hidden) { lastT = ms / 1000; requestAnimationFrame(frame); return; }
 const time = ms / 1000;
	let dt = Math.min(0.05, time - lastT || 0.016);
	if (!adaptOff && leafSkip < 2) { slowAcc += (time - lastT) || 0; slowN++; if (slowN >= 40) { if (slowAcc / slowN > 0.045) leafSkip++; slowAcc = 0; slowN = 0; } }
	lastT = time;
	updateWorld(dt, time);
	updateTree(time);
	if (!off.sky) drawSky();
	if (!off.cel) celHit = drawCelestial(time);
	if (!off.hills) drawHills();
	if (!off.clouds) cloudHit = drawClouds(dt);
	if (!off.ground) drawGround(time);
	if (!coached && !off.ground) drawCoachPulse(time);
	if (cacheOn) {
		/* crown and trunk: the layer redraws ~20 times a second, everything else every frame */
		if (treeCacheT < 0 || time - treeCacheT >= TREE_INTERVAL || yaw !== cacheYaw || (treeCv.width !== canvas.width || treeCv.height !== canvas.height)) {
			treeCacheT = time;
			cacheYaw = yaw;
			if (treeCv.width !== canvas.width || treeCv.height !== canvas.height) { treeCv.width = canvas.width; treeCv.height = canvas.height; }
			ctx = treeCtx;
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.clearRect(0, 0, treeCv.width, treeCv.height);
			ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
			if (!off.tree) drawTree();
			if (!off.leaves) drawLeaves(time, 'static');
			ctx = mainCtx;
		}
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.drawImage(treeCv, 0, 0);
		ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
		if (!off.leaves) drawLeaves(time, 'falling');
	} else {
		if (!off.tree) drawTree();
		if (!off.leaves) drawLeaves(time);
	}
	if (dayNight > 0.03 && !off.night) {
		/* night darkening of foliage and trunk */
		ctx.save();
		ctx.globalCompositeOperation = 'multiply';
		ctx.globalAlpha = dayNight * 0.38;
		ctx.fillStyle = '#22355c';
		ctx.fillRect(0, 0, W, H);
		ctx.restore();
	}
	if (!off.rain) drawRain(dt);
	if (!off.snow) drawSnow(dt, time);
	if (!off.petals) drawPetals(dt, time);
	if (!off.flowers) drawFlowers(time);
	if (!off.birds) drawBirds(dt, time);
	if (!off.fireflies) drawFireflies(time);
	drawLightning();
	requestAnimationFrame(frame);
}

/* ---------- Interaction ---------- */
const hintEl = document.getElementById('hint');
const coachEl = document.getElementById('coach');
setTimeout(() => hintEl.classList.add('faded'), 12000);

function onTap(x, y) {
	try { Sound.start(); } catch (_) { /* Sound must never block interaction. */ }
	hintEl.classList.add('faded');
	/* sun / moon first: where the storm cloud drifts over them, the visible disc stays tappable */
	const cx = dayNight < 0.5 ? celHit.sunX : celHit.moonX;
	const cy = dayNight < 0.5 ? celHit.sunY : celHit.moonY;
	if (Math.hypot(x - cx, y - cy) < 46) {
		dayNightTarget = dayNightTarget > 0.5 ? 0 : 1;
		dnTimer = dayNightTarget > 0.5 ? rand(26, 36) : rand(52, 70);
		return;
	}
	/* storm cloud */
	const dc = Math.hypot(x - cloudHit.x, y - cloudHit.y);
	if (dc < cloudHit.r) {
		const winter = currentSeason() === 3;
		if (precipMode === 'off') precipMode = winter ? 'snow' : 'rain';
		else if (precipMode === 'rain') precipMode = 'storm';
		else precipMode = 'off';
		autoWeatherOff = false;
		autoWeatherTimer = rand(30, 55);
		return;
	}
	/* anything else - a gust of wind */
	gustTarget = 1;
	gustTimer = rand(1.2, 2.2);
}

/* A long press is the growing gesture, not an invitation to copy: never let the browser open its menu. */
document.addEventListener('contextmenu', e => { if (e.target === canvas || stageEl.contains(e.target)) e.preventDefault(); });

function tapCanvas(e) {
 const p = e.touches ? e.touches[0] : e;
 const r = canvas.getBoundingClientRect();
 onTap((p.clientX - r.left) * W / r.width, (p.clientY - r.top) * H / r.height);
}
if (window.PointerEvent) {
	let downX = 0, downY = 0, lastMoveX = 0, movedFar = false, grewThisPress = false;
	const activePtrs = new Set();
	let holdTimer = 0;
	canvas.style.touchAction = 'none';
	canvas.addEventListener('pointerdown', e => {
		activePtrs.add(e.pointerId);
		if (activePtrs.size === 2 && growHold > 0) growHold = -1;   /* a second finger turns growth around */
		downX = e.clientX; downY = e.clientY; lastMoveX = e.clientX;
		movedFar = false; orbitDrag = false; yawVel = 0; grewThisPress = false;
		clearTimeout(holdTimer);
		holdTimer = setTimeout(() => {
			if (!movedFar && activePtrs.size > 0) {
				const r = canvas.getBoundingClientRect();
				const gy = (downY - r.top) * H / r.height;
				if (gy < groundY - H * 0.08) return;   /* only the ground by the roots grows the tree; the sky is for looking */
				growHold = activePtrs.size >= 2 ? -1 : 1;   /* holding the ground pours years into the roots */
				grewThisPress = true;
				coached = true;   /* the first growth retires the coach marks */
				if (coachEl) coachEl.classList.add('faded');
				try { Sound.start(); } catch (_) { /* Sound must never block interaction. */ }
				hintEl.classList.add('faded');
			}
		}, 300);
		try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* capture is a nicety, not a need */ }
	});
	canvas.addEventListener('pointermove', e => {
		if (!(e.buttons & 1)) return;
		if (growHold !== 0) return;   /* while growing, the hand stays on the ground */
		const dx = e.clientX - downX, dy = e.clientY - downY;
		if (!movedFar && Math.hypot(dx, dy) > 8) { movedFar = true; orbitDrag = true; clearTimeout(holdTimer); }
		if (orbitDrag) {
			yawVel = (e.clientX - lastMoveX) * 0.0085;   /* drag the tree itself to walk around it */
			yaw += yawVel;
			lastMoveX = e.clientX;
		}
	});
	const endPress = e => {
		activePtrs.delete(e.pointerId);
		clearTimeout(holdTimer);
		if (activePtrs.size === 0) {
			if (!movedFar && !grewThisPress) tapCanvas(e);
			orbitDrag = false; growHold = 0;
		} else if (growHold !== 0) {
			growHold = activePtrs.size >= 2 ? -1 : 1;
		}
	};
	canvas.addEventListener('pointerup', endPress);
	canvas.addEventListener('pointercancel', endPress);
} else {
 let lastTouch = 0;
 canvas.addEventListener('touchstart', e => { lastTouch = Date.now(); tapCanvas(e); }, {passive:true});
 canvas.addEventListener('mousedown', e => { if (Date.now() - lastTouch > 700) tapCanvas(e); });
}

/* Manual choices restart the chosen story, never the clock. Rebuild only state,
   not geometry, so winter-to-autumn also restores a full living crown. */
function enterSeason(i) {
	yearT = i + 0.02;
	previousSeason = i;
	for (const leaf of leaves) leaf.state = i === 3 && !leaf.winterKeep ? 'gone' : 'attached';
	groundLeaves.length = 0;
	petalFade = 0;
	snowAmount = 0;
	autoWeatherOff = false;
	autoWeatherTimer = i === 3 ? 7 : rand(22, 35);
	if (i === 3) {
		precipMode = 'snow'; precipLevel = 0;
		autoWeatherOff = true; precipModeUntil = 35;
	} else if (precipMode === 'snow') {
		precipMode = 'off'; precipLevel = 0; rainVisibility = 0; snowVisibility = 0;
	}
	treeCacheT = -1;
	shownSeason = -1;
	chips.forEach(x => { x.classList.toggle('active', +x.dataset.season === i); x.setAttribute('aria-pressed', String(+x.dataset.season === i)); });
}

chips.forEach(c => c.addEventListener('click', e => {
	e.stopPropagation();
	try { Sound.start(); } catch (_) { /* Sound must never block interaction. */ }
	const i = +c.dataset.season;
	enterSeason(i);

}));

/* ---------- Age: no ruler, no numbers - the years live in the tree itself ---------- */
function ageG() { return Math.pow(Math.max(1, Math.min(200, ageYears)) / 200, 0.45); }

/* ---------- Scheduled nature sounds ---------- */
setInterval(() => {
	if (!Sound.started) return;
	const s = currentSeason();
	if (dayNight > 0.6) {
		if (s === 1 && rng() < 0.5) Sound.cricket();
		else if (rng() < 0.22) Sound.owl();
	} else if ((s === 0 || s === 1) && rng() < 0.4) {
		Sound.bird();
	}
}, 4200);

/* ---------- Size and startup ---------- */
function resize() {
	const rect = stageEl ? stageEl.getBoundingClientRect() : null;
	W = Math.max(1, Math.round(rect && rect.width ? rect.width : (window.innerWidth || document.documentElement.clientWidth || 390)));
 H = Math.max(1, Math.round(rect && rect.height ? rect.height : (window.innerHeight || document.documentElement.clientHeight || 600)));
 /* Five full-size canvas layers share a bounded pixel budget. */
 DPR = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(2000000 / (W * H)), 4096 / W, 4096 / H);
	canvas.width = W * DPR; canvas.height = H * DPR;
	ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
	groundY = H * 0.78;
	[hillsFar, hillsNear, groundCanvas, starsCanvas].forEach(c => { if (c) { c.width = 1; c.height = 1; } });
 treeCv.width = canvas.width; treeCv.height = canvas.height; treeCacheT = -1;
 buildBackground();
	buildTree();
	buildParticles();
}
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 120); });
if (window.ResizeObserver && stageEl) new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 120); }).observe(stageEl);
buildLeafSprites();
buildRotSprites();
buildPetalSprites();
resize();
requestAnimationFrame(frame);

/* Control handle for state testing */
window.__scene = {
	setSeason(i, p) { enterSeason(i); yearT = i + (p === undefined ? 0.02 : p); },
	setNight(v) { autoDN = false; dayNightTarget = v ? 1 : 0; dayNight = dayNightTarget; },
	setWeather(m) { precipMode = m; precipLevel = m === 'off' ? 0 : 0.75; autoWeatherOff = false; autoWeatherTimer = 9999; },
	setSnow(v) { snowAmount = v; },
	fish() { fishNext = 0; },
	gust() { gustTarget = 1; gustTimer = 2; },
	setAge(y) { ageIntro = false; ageTarget = Math.max(1, Math.min(200, y)); ageYears = ageTarget; },
	setYaw(v) { yaw = v; yawVel = 0; },
	age() { return { years: +ageYears.toFixed(1), target: ageTarget, g: +ageG().toFixed(3) }; },
	grow() { return growHold; },
	coached() { return coached; },
	step(sec) { const t0 = performance.now() / 1000; for (let i = 0; i < sec / 0.05; i++) updateWorld(0.05, t0 + i * 0.05); },
	setAuto(v) { autoDN = v; },
	dn() { return [+dayNight.toFixed(2), dayNightTarget, +dnTimer.toFixed(1), leafSkip]; },
	off(n, v) { off[n] = v; },
	cache(v) { cacheOn = v; },
	interval(v) { TREE_INTERVAL = v; },
	noAdapt() { adaptOff = true; leafSkip = 1; },
	perf() { const r = {}; const m = (n, f) => { const t = performance.now(); for (let i = 0; i < 5; i++) f(); r[n] = +((performance.now() - t) / 5).toFixed(1); }; m('tree', drawTree); m('leaves', () => drawLeaves(1)); m('ground', () => drawGround(1)); m('sky', drawSky); m('hills', drawHills); m('rain', () => drawRain(0.016)); m('snow', () => drawSnow(0.016, 1)); return r; },
	strike() { lightning = 1; lightningCount++; makeBolt(); },
	snap() {
		let att = 0, fall = 0;
		for (const l of leaves) { if (l.state === 'attached') att++; else if (l.state === 'falling') fall++; }
		return { yearT, yaw: +yaw.toFixed(2), cycling: true, season: currentSeason(), sp: +seasonProgress().toFixed(2), dayNight: +dayNight.toFixed(2), precipMode, precipLevel: +precipLevel.toFixed(2), snow: +snowAmount.toFixed(2), segs: segments.length, leaves: leaves.length, attached: att, falling: fall, ground: groundLeaves.length, wind: +windSmooth.toFixed(2), flakes: snowFlakes.length, f0: snowFlakes[0] ? [snowFlakes[0].x | 0, snowFlakes[0].y | 0] : null, snowDrawn, lightningCount, fishActive: fishT >= 0, lightning: +lightning.toFixed(2) };
	}
};

 setTimeout(resize, 150);
 setTimeout(resize, 500);
}

function boot() {
 if (document.getElementById('scene')) {
  startLivingTree();
 } else {
  setTimeout(boot, 30);
 }
}
boot();
})();
