'use strict';
/* Rysowanka – rysowanie dla najmłodszych.
   Canvas + czysty JavaScript, bez bibliotek. Świat gry ma 1280×720 jednostek i skaluje się do ekranu.
   Po lewej przybornik (ołówek, kredka, flamaster, pędzel…), na dole kolory, po prawej grubość
   i przyciski: cofnij, nowa kartka, zapisz, galeria. Rysunek leży na osobnej warstwie `paint`
   (RES razy gęstszej niż świat), a galeria rysunków jest w IndexedDB. Naklejki to emoji. */
(() => {
  const W = 1280, H = 720;
  const FONT = 'Outfit, system-ui, sans-serif';
  const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Segoe UI Symbol", sans-serif';
  const C = {
    desk: '#8E5BE6', ink: '#3B3550', violet: '#8A6FDF', red: '#E5483B',
  };

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let DPR = 1, scale = 1, offX = 0, offY = 0;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const cw = window.innerWidth, ch = window.innerHeight;
    canvas.width = Math.round(cw * DPR); canvas.height = Math.round(ch * DPR);
    canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
    scale = Math.min(cw / W, ch / H);
    offX = (cw - W * scale) / 2; offY = (ch - H * scale) / 2;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- zapis ustawień ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };

  // ---------- pomocnicze ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const easeOut = (k) => 1 - Math.pow(1 - k, 3);
  const easeBack = (k) => { const c = 1.7; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
  const inRect = (p, r, pad = 0) => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
  const hitC = (p, b, pad = 8) => Math.hypot(p.x - b.x, p.y - b.y) < b.r + pad;
  function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function rr(x, y, w, h, r, c = ctx) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function circle(x, y, r, fill, c = ctx) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); if (fill) { c.fillStyle = fill; c.fill(); } }
  function ellipse(x, y, rx, ry, fill, rot = 0) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); if (fill) { ctx.fillStyle = fill; ctx.fill(); } }
  function poly(pts, fill, c = ctx) { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); if (fill) { c.fillStyle = fill; c.fill(); } }
  /* gwiazdka z `n` ramion */
  function star(x, y, r, fill, n = 4, inner = 0.38, c = ctx, rot = 0) {
    c.beginPath();
    for (let j = 0; j < n * 2; j++) {
      const a = rot - Math.PI / 2 + (j / (n * 2)) * Math.PI * 2, rad = j % 2 ? r * inner : r;
      c.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    c.closePath(); c.fillStyle = fill; c.fill();
  }
  function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  /* k > 0 rozjaśnia (do bieli), k < 0 przyciemnia */
  function shade(h, k) {
    const [r, g, b] = hexRgb(h), t = k > 0 ? 255 : 0, a = Math.abs(k);
    return `rgb(${Math.round(r + (t - r) * a)},${Math.round(g + (t - g) * a)},${Math.round(b + (t - b) * a)})`;
  }
  const isDark = (h) => { const [r, g, b] = hexRgb(h); return r * 0.3 + g * 0.59 + b * 0.11 < 90; };
  const toBlob = (c, type = 'image/png', q) => new Promise((res) => c.toBlob(res, type, q));
  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      const url = typeof src === 'string' ? src : URL.createObjectURL(src);
      img.onload = () => { if (url !== src) URL.revokeObjectURL(url); res(img); };
      img.onerror = () => rej(new Error('obrazek'));
      img.src = url;
    });
  }

  // ---------- dźwięk (Web Audio, bez plików) ----------
  let soundOn = store.get('rysowanka-sound', true);
  let AC = null;
  function audio() {
    if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (AC.state === 'suspended') AC.resume();
    return AC;
  }
  function tone(f, d, type = 'sine', v = 0.08, delay = 0, slideTo = 0) {
    if (!soundOn) return;
    const a = audio(); if (!a) return;
    const t0 = a.currentTime + delay;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + d);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    o.connect(g); g.connect(a.destination); o.start(t0); o.stop(t0 + d + 0.02);
  }
  let noiseBuf = null;
  function noise(d, v = 0.15, freq = 1500, delay = 0, q = 1) {
    if (!soundOn) return;
    const a = audio(); if (!a) return;
    if (!noiseBuf) {
      noiseBuf = a.createBuffer(1, a.sampleRate * 0.5, a.sampleRate);
      const ch = noiseBuf.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    }
    const t0 = a.currentTime + delay;
    const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = noiseBuf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(v, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    s.connect(f); f.connect(g); g.connect(a.destination); s.start(t0); s.stop(t0 + d + 0.02);
  }
  const sfx = {
    tick: () => tone(720, 0.07, 'triangle', 0.05, 0, 980),
    pop: () => { tone(380, 0.12, 'sine', 0.1, 0, 900); tone(1250, 0.1, 'triangle', 0.04, 0.06); },
    splash: () => { noise(0.35, 0.16, 650, 0, 0.6); tone(320, 0.25, 'sine', 0.07, 0, 140); },
    swish: () => { noise(0.3, 0.12, 2400, 0, 0.5); tone(500, 0.3, 'sine', 0.04, 0.05, 1100); },
    shutter: () => { noise(0.05, 0.35, 3200, 0, 1.5); noise(0.08, 0.28, 1800, 0.09, 1.5); },
    undo: () => tone(640, 0.14, 'triangle', 0.06, 0, 330),
    hmm: () => { tone(330, 0.2, 'sine', 0.08); tone(247, 0.28, 'sine', 0.08, 0.2); },
    trash: () => { noise(0.18, 0.2, 900, 0, 0.8); tone(400, 0.3, 'triangle', 0.05, 0.05, 120); },
    sparkle: () => [1568, 2093, 2637].forEach((f, i) => tone(f, 0.12, 'sine', 0.03, i * 0.05)),
    fanfare: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i === 3 ? 0.5 : 0.18, 'triangle', 0.06, i * 0.1)),
  };

  // ---------- lektor (synteza mowy urządzenia) ----------
  let glos = null;
  function ocenGlos(g) {
    let p = 0;
    if (/^pl/i.test(g.lang) || /polish|polski/i.test(g.name)) p += 100; else p -= 200;
    if (/natural|neural|online/i.test(g.name)) p += 60;
    if (/desktop/i.test(g.name)) p -= 40;
    if (g.localService === false) p += 10;
    return p;
  }
  function szukajGlosu() {
    let v = [];
    try { v = (window.speechSynthesis.getVoices() || []).slice(); } catch (e) {}
    v.sort((a, b) => ocenGlos(b) - ocenGlos(a));
    glos = v[0] && ocenGlos(v[0]) > 0 ? v[0] : null;
  }
  if (window.speechSynthesis) { szukajGlosu(); window.speechSynthesis.onvoiceschanged = szukajGlosu; }
  function mow(t) {
    if (!soundOn || !window.speechSynthesis || !t) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(t);
      u.lang = 'pl-PL';
      u.rate = glos && /natural|neural|online/i.test(glos.name) ? 1.0 : 0.92;
      u.pitch = 1.05;
      if (glos) u.voice = glos;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  // ---------- przybornik, kolory, grubości ----------
  /* w – mnożnik grubości, alpha – krycie całej kreski (nakładanie w jednej kresce nie ciemnieje) */
  const TOOLS = [
    { id: 'olowek', say: 'Ołówek', w: 0.5, alpha: 0.9 },
    { id: 'kredka', say: 'Kredka', w: 1.2, alpha: 0.95 },
    { id: 'flamaster', say: 'Flamaster', w: 1, alpha: 1 },
    { id: 'pedzel', say: 'Pędzel z farbą', w: 1.9, alpha: 0.62 },
    { id: 'zakreslacz', say: 'Zakreślacz', w: 2.3, alpha: 0.4 },
    { id: 'neon', say: 'Świecący pisak', w: 0.9, alpha: 1 },
    { id: 'tecza', say: 'Tęczowy pisak', w: 1.1, alpha: 1 },
    { id: 'spray', say: 'Spray', w: 2.2, alpha: 1 },
    { id: 'brokat', say: 'Brokat', w: 1.6, alpha: 1 },
    { id: 'wiadro', say: 'Wiaderko z farbą. Dotknij, a pomaluje całe pole.', w: 0, alpha: 1 },
    { id: 'gumka', say: 'Gumka', w: 2.2, alpha: 1 },
    { id: 'naklejki', say: 'Naklejki!', w: 0, alpha: 1 },
  ];
  const NO_COLOR = new Set(['tecza', 'gumka', 'naklejki']);
  const COLORS = [
    ['#2B2B2B', 'czarny'], ['#FFFFFF', 'biały'], ['#9E9E9E', 'szary'], ['#8D5524', 'brązowy'],
    ['#F2C29B', 'beżowy'], ['#E53935', 'czerwony'], ['#FF80AB', 'różowy'], ['#FF9800', 'pomarańczowy'],
    ['#FFD600', 'żółty'], ['#9CCC65', 'jasnozielony'], ['#2E9D4F', 'zielony'], ['#4DD0E1', 'błękitny'],
    ['#1E88E5', 'niebieski'], ['#283593', 'granatowy'], ['#8E44AD', 'fioletowy'], ['#C9952A', 'złoty'],
  ];
  const SIZES = [3, 7, 12, 20, 32];
  const STICKER_SIZES = [55, 85, 120, 165, 230];
  const SIZE_SAY = ['Cieniutko', 'Cienko', 'Średnio', 'Grubo', 'Bardzo grubo'];
  const STICKER_SIZE_SAY = ['Malutka', 'Mała', 'Średnia', 'Duża', 'Ogromna'];
  const PAPERS = [
    ['#FFFFFF', 'biała'], ['#FFF4D6', 'żółciutka'], ['#DDEFFF', 'niebieska'],
    ['#FFE1EC', 'różowa'], ['#E2F5E4', 'zielona'], ['#2B2840', 'czarna'],
  ];

  // ---------- naklejki (emoji) ----------
  const CATS = [
    { icon: '🐶', say: 'Zwierzątka', items: [
      ['🐶', 'piesek'], ['🐱', 'kotek'], ['🐭', 'myszka'], ['🐹', 'chomik'], ['🐰', 'króliczek'], ['🐮', 'krówka'],
      ['🐷', 'świnka'], ['🐴', 'konik'], ['🐑', 'owieczka'], ['🐐', 'kózka'], ['🐔', 'kurka'], ['🐤', 'kurczaczek'],
      ['🐣', 'pisklątko'], ['🦆', 'kaczuszka'], ['🐸', 'żabka'], ['🐢', 'żółwik'], ['🐌', 'ślimak'], ['🐕', 'pies'],
      ['🐈', 'kot'], ['🐓', 'kogut'], ['🐇', 'zając'], ['🐁', 'mysz'], ['🐖', 'świnia'], ['🐄', 'krowa'],
      ['🐎', 'koń'], ['🦃', 'indyk'], ['🐦', 'ptaszek'], ['🕊️', 'gołąbek'], ['🐾', 'łapki']] },
    { icon: '🦁', say: 'Dzikie zwierzęta', items: [
      ['🦁', 'lew'], ['🐯', 'tygrys'], ['🐻', 'miś'], ['🐼', 'panda'], ['🐨', 'koala'], ['🦊', 'lisek'],
      ['🐺', 'wilk'], ['🐵', 'małpka'], ['🐒', 'małpa'], ['🐘', 'słoń'], ['🦒', 'żyrafa'], ['🦓', 'zebra'],
      ['🦏', 'nosorożec'], ['🦛', 'hipopotam'], ['🐪', 'wielbłąd'], ['🦘', 'kangur'], ['🦔', 'jeż'], ['🐿️', 'wiewiórka'],
      ['🦌', 'jeleń'], ['🐊', 'krokodyl'], ['🐍', 'wąż'], ['🦎', 'jaszczurka'], ['🦉', 'sowa'], ['🦅', 'orzeł'],
      ['🦜', 'papuga'], ['🦩', 'flaming'], ['🐧', 'pingwin'], ['🦇', 'nietoperz'], ['🦖', 'tyranozaur'], ['🦕', 'dinozaur'],
      ['🐆', 'gepard'], ['🦙', 'lama'], ['🦥', 'leniwiec'], ['🦦', 'wydra']] },
    { icon: '🐠', say: 'Morze', items: [
      ['🐟', 'rybka'], ['🐠', 'kolorowa rybka'], ['🐡', 'rozdymka'], ['🐬', 'delfin'], ['🐳', 'wieloryb'], ['🐋', 'płetwal'],
      ['🦈', 'rekin'], ['🐙', 'ośmiornica'], ['🦑', 'kałamarnica'], ['🦀', 'krab'], ['🦞', 'homar'], ['🦐', 'krewetka'],
      ['🐚', 'muszelka'], ['🐢', 'żółw'], ['🐧', 'pingwin'], ['🦆', 'kaczka'], ['⚓', 'kotwica'], ['⛵', 'żaglówka'],
      ['🚤', 'motorówka'], ['🛟', 'koło ratunkowe'], ['🏝️', 'wyspa'], ['🏖️', 'plaża'], ['🌊', 'fala'], ['🫧', 'bąbelki']] },
    { icon: '🌸', say: 'Przyroda', items: [
      ['🐝', 'pszczółka'], ['🐞', 'biedronka'], ['🦋', 'motylek'], ['🐛', 'gąsienica'], ['🐜', 'mrówka'], ['🕷️', 'pajączek'],
      ['🦗', 'konik polny'], ['🌸', 'kwiatek'], ['🌼', 'stokrotka'], ['🌻', 'słonecznik'], ['🌷', 'tulipan'], ['🌹', 'róża'],
      ['🌳', 'drzewo'], ['🌲', 'choinka'], ['🌴', 'palma'], ['🌵', 'kaktus'], ['🍄', 'grzybek'], ['🍀', 'koniczynka'],
      ['🍁', 'liść'], ['🌈', 'tęcza'], ['☀️', 'słoneczko'], ['🌙', 'księżyc'], ['⭐', 'gwiazdka'], ['☁️', 'chmurka'],
      ['🌧️', 'deszcz'], ['⛄', 'bałwanek'], ['❄️', 'śnieżynka'], ['⚡', 'piorun'], ['🔥', 'ogień'], ['💧', 'kropelka'],
      ['🌍', 'Ziemia'], ['🪐', 'planeta']] },
    { icon: '🍓', say: 'Jedzenie', items: [
      ['🍎', 'jabłko'], ['🍐', 'gruszka'], ['🍊', 'pomarańcza'], ['🍋', 'cytryna'], ['🍌', 'banan'], ['🍉', 'arbuz'],
      ['🍇', 'winogrona'], ['🍓', 'truskawka'], ['🍒', 'wisienki'], ['🍑', 'brzoskwinia'], ['🍍', 'ananas'], ['🥝', 'kiwi'],
      ['🥕', 'marchewka'], ['🌽', 'kukurydza'], ['🥦', 'brokuł'], ['🥒', 'ogórek'], ['🍅', 'pomidor'], ['🍞', 'chlebek'],
      ['🧀', 'ser'], ['🥚', 'jajko'], ['🍕', 'pizza'], ['🍔', 'hamburger'], ['🍟', 'frytki'], ['🌭', 'hot dog'],
      ['🥞', 'naleśniki'], ['🍦', 'lody'], ['🍩', 'pączek'], ['🍪', 'ciasteczko'], ['🎂', 'tort'], ['🧁', 'babeczka'],
      ['🍭', 'lizak'], ['🍬', 'cukierek'], ['🍫', 'czekolada'], ['🥛', 'mleko'], ['🧃', 'soczek']] },
    { icon: '🚗', say: 'Pojazdy', items: [
      ['🚗', 'samochód'], ['🚕', 'taksówka'], ['🚙', 'terenówka'], ['🚌', 'autobus'], ['🏎️', 'wyścigówka'], ['🚓', 'policja'],
      ['🚑', 'karetka'], ['🚒', 'straż pożarna'], ['🚐', 'busik'], ['🚚', 'ciężarówka'], ['🚜', 'traktor'], ['🚲', 'rower'],
      ['🛴', 'hulajnoga'], ['🏍️', 'motor'], ['🚂', 'lokomotywa'], ['🚃', 'wagon'], ['🚋', 'tramwaj'], ['✈️', 'samolot'],
      ['🚁', 'helikopter'], ['🚀', 'rakieta'], ['🛸', 'UFO'], ['🚢', 'statek'], ['⛵', 'żaglówka'], ['🎈', 'balonik'],
      ['🚦', 'światła'], ['🚧', 'roboty drogowe'], ['⛽', 'stacja benzynowa'], ['🛞', 'koło']] },
    { icon: '❤️', say: 'Serduszka i gwiazdki', items: [
      ['❤️', 'serce'], ['🧡', 'pomarańczowe serce'], ['💛', 'żółte serce'], ['💚', 'zielone serce'], ['💙', 'niebieskie serce'], ['💜', 'fioletowe serce'],
      ['💖', 'błyszczące serce'], ['💕', 'serduszka'], ['⭐', 'gwiazdka'], ['🌟', 'świecąca gwiazda'], ['✨', 'iskierki'], ['💫', 'gwiazdki'],
      ['🎈', 'balonik'], ['🎉', 'hurra'], ['🎊', 'konfetti'], ['🎁', 'prezent'], ['🎀', 'kokardka'], ['👑', 'korona'],
      ['💎', 'diament'], ['🔔', 'dzwoneczek'], ['🎵', 'nutka'], ['🎶', 'nutki'], ['⚽', 'piłka'], ['🏀', 'piłka do kosza'],
      ['🎨', 'paleta'], ['🏆', 'puchar'], ['🥇', 'medal'], ['✅', 'ptaszek'], ['❓', 'pytajnik'], ['❗', 'wykrzyknik'],
      ['➕', 'plus'], ['💯', 'sto punktów'], ['🔴', 'czerwona kropka'], ['🔵', 'niebieska kropka']] },
    { icon: '😀', say: 'Buźki', items: [
      ['😀', 'uśmiech'], ['😃', 'wesoła buźka'], ['😂', 'śmieszek'], ['😊', 'zadowolona buźka'], ['😍', 'zakochana buźka'], ['😘', 'buziak'],
      ['😎', 'buźka w okularach'], ['🤩', 'zachwyt'], ['🥳', 'impreza'], ['😜', 'język'], ['🤪', 'wariacik'], ['😮', 'och!'],
      ['😴', 'śpioch'], ['😢', 'smutek'], ['😭', 'płacz'], ['😡', 'złość'], ['🤔', 'hmm'], ['🤗', 'przytulas'],
      ['😇', 'aniołek'], ['🥶', 'zimno'], ['🤠', 'kowboj'], ['👻', 'duszek'], ['🤖', 'robot'], ['👽', 'kosmita'],
      ['🎃', 'dynia'], ['💩', 'kupka'], ['👋', 'pa pa'], ['👍', 'super'], ['👏', 'brawo'], ['🙌', 'hura'],
      ['✌️', 'dwa palce'], ['👀', 'oczka']] },
    { icon: '🏰', say: 'Bajki i zabawki', items: [
      ['🏰', 'zamek'], ['🏯', 'pałac'], ['🏠', 'domek'], ['🏡', 'domek z ogródkiem'], ['⛺', 'namiot'], ['🎪', 'cyrk'],
      ['🎠', 'karuzela'], ['🎡', 'diabelski młyn'], ['🎢', 'kolejka górska'], ['🧸', 'miś pluszowy'], ['🪁', 'latawiec'], ['🧩', 'puzzle'],
      ['🎲', 'kostka'], ['🪀', 'jojo'], ['🎮', 'gra'], ['🥁', 'bębenek'], ['🎸', 'gitara'], ['🎺', 'trąbka'],
      ['🎻', 'skrzypce'], ['🎹', 'pianino'], ['🐉', 'smok'], ['🦄', 'jednorożec'], ['🧙', 'czarodziej'], ['🧚', 'wróżka'],
      ['🧜', 'syrenka'], ['🦸', 'superbohater'], ['👸', 'księżniczka'], ['🤴', 'królewicz'], ['🔮', 'kryształowa kula'], ['🗝️', 'klucz'],
      ['💰', 'skarb'], ['🗺️', 'mapa skarbów'], ['🌋', 'wulkan'], ['⛰️', 'góra']] },
  ];
  const STICKER_NAME = new Map();
  for (const c of CATS) for (const [em, n] of c.items) if (!STICKER_NAME.has(em)) STICKER_NAME.set(em, n);
  /* emoji rysowane raz do małego płótna; duże kopie (do przyklejania) trzymamy tylko kilka */
  const smallCache = new Map(), bigCache = new Map();
  function renderEmoji(em, size) {
    const c = mk(size, size), x = c.getContext('2d');
    x.font = `${Math.round(size * 0.8)}px ${EMOJI}`;
    x.textAlign = 'left'; x.textBaseline = 'alphabetic';
    const m = x.measureText(em);
    const l = m.actualBoundingBoxLeft || 0, r = m.actualBoundingBoxRight || m.width;
    const a = m.actualBoundingBoxAscent || size * 0.7, d = m.actualBoundingBoxDescent || size * 0.1;
    // środek znaku dokładnie na środku płótna (emoji mają różne marginesy)
    x.fillText(em, size / 2 - (r - l) / 2, size / 2 + (a - d) / 2);
    return c;
  }
  function smallSticker(em) { let c = smallCache.get(em); if (!c) { c = renderEmoji(em, 96); smallCache.set(em, c); } return c; }
  function bigSticker(em) {
    let c = bigCache.get(em);
    if (!c) {
      c = renderEmoji(em, 256); bigCache.set(em, c);
      if (bigCache.size > 16) bigCache.delete(bigCache.keys().next().value);
    }
    return c;
  }
  function drawEmoji(em, x, y, size) { ctx.drawImage(smallSticker(em), x - size / 2, y - size / 2, size, size); }

  // ---------- układ ekranu ----------
  const PAPER = { x: 162, y: 14, w: 968, h: 580 };
  const RES = 1.6;
  const PW = Math.round(PAPER.w * RES), PH = Math.round(PAPER.h * RES);
  const TOOL_Y0 = 12, TOOL_H = 57;
  const BAR = { x: 162, y: 608, w: 968, h: 104 };
  const RX = 1206;
  const BTN = {
    undo: { x: RX, y: 54, r: 36 }, nowa: { x: RX, y: 448, r: 36 },
    zapisz: { x: RX, y: 532, r: 36 }, galeria: { x: RX, y: 616, r: 36 }, sound: { x: RX, y: 688, r: 22 },
  };
  const sizeBtn = (i) => ({ x: RX, y: 128 + i * 62, r: 28 });
  const swatch = (i) => ({ x: BAR.x + 34 + i * 60, y: BAR.y + BAR.h / 2, r: 24 });
  const DR = { x: 172, y: 196, w: 948, h: 516 };
  const TAB_X0 = DR.x + 18, TAB_STEP = 96, TAB_Y = DR.y + 12, TAB_H = 72;
  const CELL_W = 84, CELL_H = 100, GRID_X0 = DR.x + 12, GRID_Y0 = DR.y + 100, GRID_COLS = 11;
  const DR_CLOSE = { x: DR.x + DR.w - 46, y: DR.y + 48, r: 28 };
  const POP = { x: 326, y: 170, w: 640, h: 270 };
  const sheet = (i) => ({ x: POP.x + 25 + i * 102, y: POP.y + 134, w: 80, h: 104 });
  const PLAY_BTN = { x: W / 2, y: 418, r: 62 };
  const STICKER_OPEN = { x: BAR.x + 14, y: BAR.y + 12, w: 120, h: 80 };
  const recentSpot = (i) => ({ x: BAR.x + 190 + i * 66, y: BAR.y + BAR.h / 2, r: 30 });
  const GAL = { cols: 4, cw: 280, ch: 206, gx: 26, gy: 30, x0: (W - (4 * 280 + 3 * 26)) / 2, y0: 112 };
  const GAL_BACK = { x: 70, y: 58, r: 38 };
  const GAL_PREV = { x: W / 2 - 120, y: 668, r: 32 }, GAL_NEXT = { x: W / 2 + 120, y: 668, r: 32 };

  // ---------- stan ----------
  const savedTool = store.get('rysowanka-tool', 2);
  const S = {
    scene: 'title', time: 0,
    tool: savedTool, lastDraw: NO_COLOR.has(TOOLS[savedTool].id) || TOOLS[savedTool].id === 'wiadro' ? 2 : savedTool,
    color: store.get('rysowanka-color', 12), size: store.get('rysowanka-size', 1),
    paper: '#FFFFFF', sticker: '🐶', recent: store.get('rysowanka-recent', ['🐶', '🦄', '⭐', '❤️', '🚗', '🌸', '🦋', '🐠']),
    stickerIntro: false, cat: 0, drawer: false, popup: false,
    stroke: null, place: null, hover: null,
    dirty: false, blank: true, baseBlank: true, galleryId: null,
    gallery: [], galPage: 0, galLoading: false, galConfirm: null, busy: false,
  };
  const tool = () => TOOLS[S.tool];
  const col = () => COLORS[S.color][0];

  // ---------- kartka: warstwa rysunku i warstwa bieżącej kreski ----------
  const paint = mk(PW, PH), pctx = paint.getContext('2d');
  const strokeC = mk(PW, PH), sctx = strokeC.getContext('2d');
  const toPaper = (p) => ({ x: (p.x - PAPER.x) * RES, y: (p.y - PAPER.y) * RES });
  const toWorldP = (q) => ({ x: PAPER.x + q.x / RES, y: PAPER.y + q.y / RES });

  /* cofanie: kopie warstwy sprzed każdej czynności */
  const undoStack = [];
  const UNDO_MAX = 10;
  function pushUndo() {
    let c;
    if (undoStack.length >= UNDO_MAX) { c = undoStack.shift(); S.baseBlank = false; } else c = mk(PW, PH);
    const x = c.getContext('2d');
    x.clearRect(0, 0, PW, PH); x.drawImage(paint, 0, 0);
    undoStack.push(c);
  }
  function undo() {
    if (S.stroke || S.place) return;
    const c = undoStack.pop();
    if (!c) { sfx.hmm(); return; }
    pctx.clearRect(0, 0, PW, PH); pctx.drawImage(c, 0, 0);
    sfx.undo();
    S.dirty = true;
    S.blank = !undoStack.length && S.baseBlank;
    autoT = 1.2;
  }
  let autoT = 0;
  function changed() { S.dirty = true; S.blank = false; autoT = 1.2; }

  // ---------- rysowanie kresek ----------
  function beginStroke(p, pid) {
    pushUndo();
    const t = tool(), q = toPaper(p);
    S.stroke = { pid, t, p0: q, m0: q, pos: q, dist: 0, hue: rand(0, 360), w: Math.max(2, SIZES[S.size] * t.w * RES), color: col() };
    sctx.clearRect(0, 0, PW, PH);
    extendStroke(q, true);
  }
  function curve(c, s, m, w, style) {
    c.lineWidth = w; c.strokeStyle = style; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(s.m0.x, s.m0.y);
    if (s.m0 === m) c.lineTo(m.x + 0.01, m.y);
    else c.quadraticCurveTo(s.p0.x, s.p0.y, m.x, m.y);
    c.stroke();
  }
  /* kroki co `step` pikseli między a i b – dla narzędzi stemplujących (kredka, spray, brokat) */
  function walk(a, b, step, fn) {
    const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(d / step));
    for (let i = 1; i <= n; i++) fn(a.x + (b.x - a.x) * (i / n), a.y + (b.y - a.y) * (i / n));
  }
  function extendStroke(q, first = false) {
    const s = S.stroke, t = s.t, w = s.w;
    if (!first && Math.hypot(q.x - s.p0.x, q.y - s.p0.y) < 1) return;
    const m = first ? q : { x: (s.p0.x + q.x) / 2, y: (s.p0.y + q.y) / 2 };
    if (first) { s.m0 = m; s.p0 = q; }
    const from = s.m0;
    switch (t.id) {
      case 'olowek': {
        curve(sctx, s, m, w, s.color);
        // ziarno ołówka: drobne prześwity
        sctx.globalCompositeOperation = 'destination-out'; sctx.fillStyle = '#000';
        walk(from, m, 3, (x, y) => { for (let k = 0; k < 2; k++) sctx.fillRect(x + rand(-w, w) / 2, y + rand(-w, w) / 2, RES * 0.9, RES * 0.9); });
        sctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'flamaster': curve(sctx, s, m, w, s.color); break;
      case 'zakreslacz': curve(sctx, s, m, w, s.color); break;
      case 'pedzel':
        sctx.save(); sctx.shadowColor = s.color; sctx.shadowBlur = w * 0.35;
        curve(sctx, s, m, w, s.color); sctx.restore();
        break;
      case 'neon':
        // jasny rdzeń na wierzchu, blask dokładany pod spód (inaczej każdy odcinek zasłania poprzedni rdzeń)
        curve(sctx, s, m, w * 0.4, shade(s.color, 0.7));
        sctx.save(); sctx.globalCompositeOperation = 'destination-over'; sctx.shadowColor = s.color; sctx.shadowBlur = w * 1.6;
        curve(sctx, s, m, w, s.color); sctx.restore();
        break;
      case 'tecza':
        curve(sctx, s, m, w, `hsl(${(s.hue + s.dist * 0.45 / RES) % 360} 88% 55%)`);
        break;
      case 'kredka': {
        sctx.fillStyle = s.color;
        const n = Math.ceil(w * 0.9), sz = RES * 1.3;
        walk(from, m, Math.max(1.5, w * 0.2), (x, y) => {
          for (let k = 0; k < n; k++) {
            const a = rand(0, Math.PI * 2), r = Math.sqrt(Math.random()) * w / 2;
            sctx.globalAlpha = rand(0.45, 1);
            sctx.fillRect(x + Math.cos(a) * r, y + Math.sin(a) * r, sz, sz);
          }
        });
        sctx.globalAlpha = 1;
        break;
      }
      case 'spray': walk(from, m, w * 0.3, (x, y) => sprayAt({ x, y }, 0.012)); break;
      case 'brokat': {
        walk(from, m, Math.max(2, w * 0.45), (x, y) => {
          for (let k = 0; k < 3; k++) {
            const a = rand(0, Math.PI * 2), r = Math.sqrt(Math.random()) * w * 0.6;
            circle(x + Math.cos(a) * r, y + Math.sin(a) * r, w * rand(0.07, 0.17), shade(s.color, rand(-0.3, 0.5)), sctx);
          }
          if (Math.random() < 0.3) star(x + rand(-w, w) * 0.5, y + rand(-w, w) * 0.5, w * rand(0.25, 0.5), Math.random() < 0.5 ? '#FFFFFF' : '#FFE27A', 4, 0.3, sctx);
        });
        if (Math.random() < 0.25) twinkle(toWorldP(m));
        break;
      }
      case 'gumka':
        pctx.save(); pctx.globalCompositeOperation = 'destination-out';
        curve(pctx, s, m, w, '#000'); pctx.restore();
        break;
    }
    s.dist += Math.hypot(m.x - from.x, m.y - from.y);
    s.m0 = m; s.p0 = q; s.pos = q;
  }
  function sprayAt(q, dt) {
    const s = S.stroke, r = s.w, n = Math.ceil(dt * (900 + r * 30));
    sctx.fillStyle = s.color;
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), d = r * Math.sqrt(Math.random()) * (Math.random() < 0.7 ? 0.7 : 1);
      const sz = rand(0.6, 1.7) * RES;
      sctx.fillRect(q.x + Math.cos(a) * d, q.y + Math.sin(a) * d, sz, sz);
    }
  }
  function endStroke() {
    const s = S.stroke;
    if (!s) return;
    S.stroke = null;
    if (s.t.id !== 'gumka') {
      // dokończ kreskę do ostatniego punktu
      pctx.save(); pctx.globalAlpha = s.t.alpha; pctx.drawImage(strokeC, 0, 0); pctx.restore();
      sctx.clearRect(0, 0, PW, PH);
    }
    changed();
  }

  // ---------- wiaderko: wypełnianie pola ----------
  function floodFill(px, py, hex) {
    px = Math.floor(px); py = Math.floor(py);
    if (px < 0 || py < 0 || px >= PW || py >= PH) return false;
    const img = pctx.getImageData(0, 0, PW, PH), d = img.data;
    const [r, g, b] = hexRgb(hex);
    const i0 = (py * PW + px) * 4;
    const sr = d[i0], sg = d[i0 + 1], sb = d[i0 + 2], sa = d[i0 + 3];
    if (sa > 250 && Math.abs(sr - r) < 6 && Math.abs(sg - g) < 6 && Math.abs(sb - b) < 6) return false;
    const TOL = 70;
    const match = (j) => {
      const i = j * 4, a = d[i + 3];
      if (sa < 30) return a < 110;
      return Math.abs(a - sa) <= TOL && Math.abs(d[i] - sr) <= TOL && Math.abs(d[i + 1] - sg) <= TOL && Math.abs(d[i + 2] - sb) <= TOL;
    };
    const mask = new Uint8Array(PW * PH);
    const stack = [px, py];
    while (stack.length) {
      const y = stack.pop(), x = stack.pop(), row = y * PW;
      let xl = x, xr = x;
      if (mask[row + x] || !match(row + x)) continue;
      while (xl > 0 && !mask[row + xl - 1] && match(row + xl - 1)) xl--;
      while (xr < PW - 1 && !mask[row + xr + 1] && match(row + xr + 1)) xr++;
      for (let i = xl; i <= xr; i++) mask[row + i] = 1;
      for (const ny of [y - 1, y + 1]) {
        if (ny < 0 || ny >= PH) continue;
        const nrow = ny * PW;
        let run = false;
        for (let i = xl; i <= xr; i++) {
          const ok = !mask[nrow + i] && match(nrow + i);
          if (ok && !run) { stack.push(i, ny); run = true; } else if (!ok) run = false;
        }
      }
    }
    // pole powiększone o 1 piksel, żeby nie zostawała jasna obwódka przy krawędziach kresek
    for (let y = 0; y < PH; y++) {
      const row = y * PW;
      for (let x = 0; x < PW; x++) {
        const j = row + x;
        if (!mask[j] && ((x > 0 && mask[j - 1] === 1) || (x < PW - 1 && mask[j + 1] === 1) || (y > 0 && mask[j - PW] === 1) || (y < PH - 1 && mask[j + PW] === 1))) mask[j] = 2;
      }
    }
    for (let j = 0; j < mask.length; j++) {
      if (!mask[j]) continue;
      const i = j * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    }
    pctx.putImageData(img, 0, 0);
    return true;
  }
  function fillAt(p) {
    const q = toPaper(p);
    const snap = mk(PW, PH); snap.getContext('2d').drawImage(paint, 0, 0);
    if (!floodFill(q.x, q.y, col())) { sfx.tick(); return; }
    // kopia sprzed wypełnienia trafia na stos cofania
    if (undoStack.length >= UNDO_MAX) { undoStack.shift(); S.baseBlank = false; }
    undoStack.push(snap);
    sfx.splash();
    burst(p.x, p.y, 12, [col(), shade(col(), 0.4), '#FFFFFF']);
    fxAdd(0.45, (k) => {
      ctx.save(); ctx.globalAlpha = 1 - k; ctx.strokeStyle = col(); ctx.lineWidth = 8 * (1 - k) + 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 20 + easeOut(k) * 70, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    });
    changed();
  }

  // ---------- naklejki ----------
  function stamp(em, p) {
    pushUndo();
    const q = toPaper(p), sz = STICKER_SIZES[S.size] * RES;
    pctx.drawImage(bigSticker(em), q.x - sz / 2, q.y - sz / 2, sz, sz);
    sfx.pop();
    burst(p.x, p.y, 10, ['#FFD34D', '#FFFFFF', '#FF80AB', '#7BC8A4']);
    changed();
  }
  function pickSticker(em) {
    S.sticker = em;
    S.recent = [em, ...S.recent.filter((x) => x !== em)].slice(0, 12);
    store.set('rysowanka-recent', S.recent);
    S.drawer = false;
    sfx.pop();
    const name = STICKER_NAME.get(em) || '';
    const n = name.charAt(0).toUpperCase() + name.slice(1);
    if (!S.stickerIntro) { S.stickerIntro = true; mow(`${n}! Dotknij kartki, żeby przykleić.`); } else mow(n);
  }

  // ---------- wybór narzędzi ----------
  function selectTool(i) {
    if (i < 0 || i >= TOOLS.length) return;
    const t = TOOLS[i];
    tap('tool' + i);
    if (i === S.tool && t.id === 'naklejki') { S.drawer = true; sfx.tick(); return; }
    S.tool = i; store.set('rysowanka-tool', i);
    if (!NO_COLOR.has(t.id) && t.id !== 'wiadro') S.lastDraw = i;
    sfx.tick();
    if (t.id === 'naklejki') { S.drawer = true; mow('Naklejki! Wybierz naklejkę.'); } else mow(t.say);
  }
  function selectColor(i) {
    S.color = i; store.set('rysowanka-color', i); tap('col' + i);
    sfx.tick();
    // kolor przy gumce albo tęczy znaczy: chcę rysować tym kolorem
    if (NO_COLOR.has(tool().id)) { S.tool = S.lastDraw; store.set('rysowanka-tool', S.tool); }
    mow(COLORS[i][1].charAt(0).toUpperCase() + COLORS[i][1].slice(1));
  }
  function selectSize(i) {
    S.size = i; store.set('rysowanka-size', i); tap('size' + i);
    sfx.tick();
    mow(tool().id === 'naklejki' ? STICKER_SIZE_SAY[i] : SIZE_SAY[i]);
  }

  // ---------- galeria (IndexedDB) ----------
  let db = null;
  function dbOpen() {
    return new Promise((res, rej) => {
      if (!window.indexedDB) { rej(new Error('brak IndexedDB')); return; }
      const r = indexedDB.open('rysowanka', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('rysunki', { keyPath: 'id' }); r.result.createObjectStore('stan'); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  function tx(name, mode, fn) {
    return new Promise((res, rej) => {
      if (!db) { rej(new Error('brak bazy')); return; }
      const t = db.transaction(name, mode);
      const req = fn(t.objectStore(name));
      let out;
      if (req) req.onsuccess = () => { out = req.result; };
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  const dbPut = (name, val, key) => tx(name, 'readwrite', (s) => (key === undefined ? s.put(val) : s.put(val, key)));
  const dbGet = (name, key) => tx(name, 'readonly', (s) => s.get(key));
  const dbAll = (name) => tx(name, 'readonly', (s) => s.getAll());
  const dbDel = (name, key) => tx(name, 'readwrite', (s) => s.delete(key));

  function makeThumb(w = 520, h = 312) {
    const c = mk(w, h), x = c.getContext('2d');
    x.fillStyle = S.paper; x.fillRect(0, 0, w, h);
    x.drawImage(paint, 0, 0, w, h);
    return c;
  }
  /* zdjęcie bieżącego rysunku robione od razu (synchronicznie), zapis do bazy – potem */
  function takeSnapshot() {
    const id = S.galleryId || 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const snap = { id, paper: S.paper, thumb: makeThumb().toDataURL('image/jpeg', 0.85), imgP: toBlob(paint) };
    S.galleryId = id; S.dirty = false;
    return snap;
  }
  async function storeSnapshot(snap) {
    const img = await snap.imgP;
    if (!img) throw new Error('toBlob');
    await dbPut('rysunki', { id: snap.id, t: Date.now(), paper: snap.paper, img, thumb: snap.thumb });
  }
  async function saveCurrent() {
    autoT = 0;
    if (!db) return;
    try {
      const img = await toBlob(paint);
      await dbPut('stan', { paper: S.paper, img, galleryId: S.galleryId, dirty: S.dirty, blank: S.blank }, 'biezacy');
    } catch (e) {}
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden && S.scene !== 'title') saveCurrent(); });

  async function onSave() {
    if (S.stroke || S.busy) return;
    if (S.blank) { sfx.hmm(); mow('Kartka jest pusta. Najpierw coś narysuj!'); return; }
    if (!db) { sfx.hmm(); mow('Nie umiem tu zapisywać rysunków.'); return; }
    sfx.shutter();
    const pic = makeThumb(260, 156);
    fxAdd(0.35, (k) => { ctx.fillStyle = `rgba(255,255,255,${0.85 * (1 - k)})`; ctx.fillRect(PAPER.x, PAPER.y, PAPER.w, PAPER.h); });
    fxAdd(0.9, (k) => {
      const e = easeOut(clamp((k - 0.15) / 0.85, 0, 1));
      const w = lerp(PAPER.w, 64, e), h = w * 0.6;
      const x = lerp(PAPER.x + PAPER.w / 2, BTN.galeria.x, e), y = lerp(PAPER.y + PAPER.h / 2, BTN.galeria.y, e) - Math.sin(e * Math.PI) * 120;
      ctx.save(); ctx.translate(x, y); ctx.rotate(e * -0.3);
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(-w / 2 - 6, -h / 2 - 6, w + 12, h + 12);
      ctx.drawImage(pic, -w / 2, -h / 2, w, h);
      ctx.restore();
    });
    S.busy = true;
    try {
      await storeSnapshot(takeSnapshot());
      saveCurrent();
      setTimeout(() => { sfx.sparkle(); burst(BTN.galeria.x, BTN.galeria.y, 14, ['#FFD34D', '#FFFFFF', C.violet]); }, 800);
      mow('Zapisane w galerii!');
    } catch (e) { mow('Nie udało się zapisać.'); }
    S.busy = false;
  }
  async function newPage(paper) {
    if (S.busy) return;
    S.popup = false;
    let snap = null;
    if (!S.blank && S.dirty && db) snap = takeSnapshot();
    pctx.clearRect(0, 0, PW, PH);
    undoStack.length = 0;
    S.paper = paper; S.galleryId = null; S.dirty = false; S.blank = true; S.baseBlank = true;
    if (isDark(paper) && S.color === 0) S.color = 1;
    if (!isDark(paper) && S.color === 1) S.color = 0;
    sfx.swish();
    fxAdd(0.5, (k) => {
      ctx.save(); ctx.globalAlpha = 1 - k;
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(PAPER.x, PAPER.y, PAPER.w, PAPER.h);
      ctx.restore();
    });
    const name = (PAPERS.find((p) => p[0] === paper) || [0, ''])[1];
    let saved = false;
    if (snap) { S.busy = true; try { await storeSnapshot(snap); saved = true; } catch (e) {} S.busy = false; }
    mow(saved ? `Rysunek schowany w galerii. Nowa ${name} kartka!` : `Nowa ${name} kartka!`);
    saveCurrent();
  }
  async function openGallery() {
    if (S.busy) return;
    S.scene = 'gallery'; S.galLoading = true; S.galPage = 0; S.galConfirm = null; S.drawer = false; S.popup = false;
    sfx.tick();
    try {
      if (!db) throw new Error('brak bazy');
      if (!S.blank && S.dirty) { await storeSnapshot(takeSnapshot()); saveCurrent(); }
      const recs = await dbAll('rysunki');
      recs.sort((a, b) => b.t - a.t);
      S.gallery = recs.map((rec) => { const img = new Image(); img.src = rec.thumb; return { rec, img }; });
      mow(S.gallery.length ? 'Twoje rysunki! Dotknij obrazka, żeby rysować dalej.' : 'Galeria jest pusta. Narysuj coś!');
    } catch (e) {
      S.gallery = [];
      mow('Galeria nie działa w tej przeglądarce.');
    }
    S.galLoading = false;
  }
  async function openDrawing(rec) {
    if (S.busy) return;
    if (rec.id === S.galleryId) { S.scene = 'draw'; sfx.tick(); mow('Rysujemy dalej!'); return; }
    S.busy = true;
    try {
      const snap = !S.blank && S.dirty ? takeSnapshot() : null;
      const im = await loadImage(rec.img);
      if (snap) await storeSnapshot(snap);
      pctx.clearRect(0, 0, PW, PH); pctx.drawImage(im, 0, 0, PW, PH);
      undoStack.length = 0;
      S.paper = rec.paper; S.galleryId = rec.id; S.dirty = false; S.blank = false; S.baseBlank = false;
      S.scene = 'draw';
      sfx.pop();
      mow('Rysujemy dalej!');
      saveCurrent();
    } catch (e) { sfx.hmm(); }
    S.busy = false;
  }
  async function deleteDrawing(rec) {
    try { await dbDel('rysunki', rec.id); } catch (e) { return; }
    S.gallery = S.gallery.filter((g) => g.rec.id !== rec.id);
    if (S.galleryId === rec.id) { S.galleryId = null; S.dirty = !S.blank; saveCurrent(); }
    sfx.trash();
  }
  /* zapis obrazka na urządzenie: na telefonie „udostępnij”, na komputerze pobranie pliku */
  async function exportDrawing(rec) {
    sfx.tick();
    try {
      const im = await loadImage(rec.img);
      const c = mk(PW, PH), x = c.getContext('2d');
      x.fillStyle = rec.paper; x.fillRect(0, 0, PW, PH); x.drawImage(im, 0, 0, PW, PH);
      const blob = await toBlob(c);
      const name = 'rysunek-' + new Date(rec.t).toISOString().slice(0, 16).replace(/[T:]/g, '-') + '.png';
      const file = new File([blob], name, { type: 'image/png' });
      if (matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file] }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) { sfx.hmm(); }
  }

  // ---------- start ----------
  const dbReady = dbOpen().then(async (d) => {
    db = d;
    const cur = await dbGet('stan', 'biezacy');
    if (cur && cur.img) {
      const im = await loadImage(cur.img);
      pctx.clearRect(0, 0, PW, PH); pctx.drawImage(im, 0, 0, PW, PH);
      S.paper = cur.paper || '#FFFFFF'; S.galleryId = cur.galleryId || null;
      S.dirty = !!cur.dirty; S.blank = !!cur.blank; S.baseBlank = S.blank;
    }
  }).catch(() => {});
  function start() {
    try {
      if (matchMedia('(pointer: coarse)').matches && document.documentElement.requestFullscreen && !document.fullscreenElement) {
        document.documentElement.requestFullscreen().then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
      }
    } catch (e) {}
    S.scene = 'draw';
    sfx.fanfare();
    mow(S.blank ? 'Rysujemy! Wybierz pisak i kolor.' : 'Rysujemy dalej!');
  }

  // ---------- sterowanie (mysz, palec, rysik) ----------
  function toWorld(e) { return { x: (e.clientX - offX) / scale, y: (e.clientY - offY) / scale }; }
  function toggleSound() {
    tap('sound'); soundOn = !soundOn; store.set('rysowanka-sound', soundOn);
    if (!soundOn && window.speechSynthesis) window.speechSynthesis.cancel();
    sfx.tick();
  }
  function galleryDown(p) {
    if (hitC(p, GAL_BACK, 10)) { tap('back'); S.scene = 'draw'; sfx.tick(); return; }
    const pages = Math.max(1, Math.ceil(S.gallery.length / 8));
    if (pages > 1 && hitC(p, GAL_PREV, 10)) { tap('prev'); S.galPage = (S.galPage + pages - 1) % pages; sfx.tick(); return; }
    if (pages > 1 && hitC(p, GAL_NEXT, 10)) { tap('next'); S.galPage = (S.galPage + 1) % pages; sfx.tick(); return; }
    galCards().forEach(({ g, x, y }) => {
      const rec = g.rec;
      if (hitC(p, { x: x + 40, y: y + 186, r: 20 }, 8)) { tap('dl' + rec.id); exportDrawing(rec); return; }
      if (hitC(p, { x: x + GAL.cw - 40, y: y + 186, r: 20 }, 8)) {
        if (S.galConfirm && S.galConfirm.id === rec.id) { S.galConfirm = null; deleteDrawing(rec); } else { S.galConfirm = { id: rec.id, t: 3 }; sfx.tick(); }
        return;
      }
      if (inRect(p, { x, y, w: GAL.cw, h: 166 })) openDrawing(rec);
    });
  }
  function drawerDown(p) {
    if (!inRect(p, DR) || hitC(p, DR_CLOSE, 6)) { tap('close'); S.drawer = false; sfx.tick(); return; }
    if (p.y >= TAB_Y && p.y <= TAB_Y + TAB_H) {
      const i = Math.floor((p.x - TAB_X0) / TAB_STEP);
      if (i >= 0 && i < CATS.length) { S.cat = i; tap('tab' + i); sfx.tick(); mow(CATS[i].say); }
      return;
    }
    const c = Math.floor((p.x - GRID_X0) / CELL_W), r = Math.floor((p.y - GRID_Y0) / CELL_H);
    if (c < 0 || c >= GRID_COLS || r < 0) return;
    const it = CATS[S.cat].items[r * GRID_COLS + c];
    if (it) pickSticker(it[0]);
  }
  function popupDown(p) {
    for (let i = 0; i < PAPERS.length; i++) if (inRect(p, sheet(i), 8)) { newPage(PAPERS[i][0]); return; }
    if (!inRect(p, POP)) { S.popup = false; sfx.tick(); }
  }
  function rightDown(p) {
    if (hitC(p, BTN.undo)) { tap('undo'); undo(); return; }
    for (let i = 0; i < 5; i++) if (hitC(p, sizeBtn(i), 3)) { selectSize(i); return; }
    if (hitC(p, BTN.nowa)) { tap('nowa'); S.popup = true; sfx.tick(); mow('Nowa kartka. Jaki kolor?'); return; }
    if (hitC(p, BTN.zapisz)) { tap('zapisz'); onSave(); return; }
    if (hitC(p, BTN.galeria)) { tap('galeria'); openGallery(); return; }
  }
  function barDown(p) {
    if (tool().id === 'naklejki') {
      if (inRect(p, STICKER_OPEN, 6)) { tap('open'); S.drawer = true; sfx.tick(); return; }
      S.recent.forEach((em, i) => { if (hitC(p, recentSpot(i), 3)) { tap('rec' + i); pickSticker(em); } });
      return;
    }
    for (let i = 0; i < COLORS.length; i++) if (hitC(p, swatch(i), 6)) { selectColor(i); return; }
  }
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    audio();
    const p = toWorld(e);
    if (S.scene !== 'title' && hitC(p, BTN.sound, 6)) { toggleSound(); return; }
    if (S.scene === 'title') { start(); return; }
    if (S.scene === 'gallery') { if (!S.galLoading) galleryDown(p); return; }
    if (S.stroke || S.place) return; // drugi palec w trakcie rysowania nic nie robi
    if (S.popup) { popupDown(p); return; }
    if (S.drawer) { drawerDown(p); return; }
    if (p.x < PAPER.x - 4) { selectTool(Math.floor((p.y - TOOL_Y0) / TOOL_H)); return; }
    if (p.x > PAPER.x + PAPER.w + 4) { rightDown(p); return; }
    if (p.y > PAPER.y + PAPER.h + 4) { barDown(p); return; }
    if (!inRect(p, PAPER)) return;
    const t = tool().id;
    if (t === 'wiadro') { fillAt(p); return; }
    if (t === 'naklejki') S.place = { pid: e.pointerId, x: p.x, y: p.y };
    else beginStroke(p, e.pointerId);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = toWorld(e);
    S.hover = e.pointerType === 'mouse' ? p : null;
    if (S.place && S.place.pid === e.pointerId) { S.place.x = p.x; S.place.y = p.y; return; }
    const s = S.stroke;
    if (!s || s.pid !== e.pointerId) return;
    let evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    if (!evs || !evs.length) evs = [e];
    for (const ev of evs) { if (S.stroke) extendStroke(toPaper(toWorld(ev))); }
  });
  const up = (e) => {
    if (S.stroke && S.stroke.pid === e.pointerId) endStroke();
    if (S.place && S.place.pid === e.pointerId) {
      const pl = S.place; S.place = null;
      if (e.type === 'pointerup' && inRect(pl, PAPER)) stamp(S.sticker, pl);
    }
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', () => { S.hover = null; });
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && S.scene === 'draw') { e.preventDefault(); undo(); }
  });

  // ---------- efekty ----------
  const fx = [], parts = [];
  function fxAdd(dur, draw) { fx.push({ t: 0, dur, draw }); }
  function burst(x, y, n, cols) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), v = rand(120, 300);
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, g: 500, life: 0, max: rand(0.45, 0.8), col: pick(cols), sz: rand(5, 10), star: Math.random() < 0.6 });
    }
  }
  function twinkle(p) {
    parts.push({ x: p.x + rand(-14, 14), y: p.y + rand(-14, 14), vx: 0, vy: -10, g: 0, life: 0, max: rand(0.4, 0.7), col: pick(['#FFFFFF', '#FFE27A']), sz: rand(5, 9), star: true });
  }

  function update(dt) {
    S.time += dt;
    for (const k in press) press[k] = Math.max(0, press[k] - dt * 5);
    for (let i = fx.length - 1; i >= 0; i--) { fx[i].t += dt; if (fx[i].t >= fx[i].dur) fx.splice(i, 1); }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt;
      if (p.life >= p.max) parts.splice(i, 1);
    }
    if (S.stroke && S.stroke.t.id === 'spray') sprayAt(S.stroke.pos, dt);
    if (autoT > 0 && !S.stroke) { autoT -= dt; if (autoT <= 0) saveCurrent(); }
    if (S.galConfirm) { S.galConfirm.t -= dt; if (S.galConfirm.t <= 0) S.galConfirm = null; }
  }

  // ---------- rysowanie: przybory ----------
  /* przybór leżący poziomo, końcówką w prawo; (0,0) to środek tylnego końca */
  function drawImpl(id, color, t = S.time) {
    const dark = shade(color, -0.3);
    switch (id) {
      case 'olowek':
        ctx.fillStyle = '#F48FB1'; rr(0, -11, 18, 22, 6); ctx.fill();
        ctx.fillStyle = '#C9CED6'; ctx.fillRect(14, -12, 10, 24);
        ctx.fillStyle = '#F6C343'; ctx.fillRect(24, -12, 70, 24);
        ctx.fillStyle = '#E9A825'; ctx.fillRect(24, -3, 70, 6);
        poly([[94, -12], [94, 12], [124, 0]], '#F2D3A2');
        poly([[114, -4], [114, 4], [125, 0]], color);
        break;
      case 'kredka':
        ctx.fillStyle = color; rr(0, -13, 98, 26, 8); ctx.fill();
        ctx.beginPath(); ctx.moveTo(96, -12); ctx.lineTo(118, -6); ctx.quadraticCurveTo(127, 0, 118, 6); ctx.lineTo(96, 12); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillRect(18, -13, 62, 26);
        ctx.fillStyle = dark; ctx.fillRect(24, -13, 4, 26); ctx.fillRect(70, -13, 4, 26);
        ctx.strokeStyle = 'rgba(59,53,80,.25)'; ctx.lineWidth = 2; rr(0, -13, 98, 26, 8); ctx.stroke();
        break;
      case 'flamaster':
        ctx.fillStyle = color; rr(0, -13, 36, 26, 8); ctx.fill();
        ctx.fillStyle = dark; ctx.fillRect(30, -13, 6, 26);
        ctx.fillStyle = '#F4F1EC'; rr(34, -11, 62, 22, 6); ctx.fill();
        ctx.strokeStyle = 'rgba(59,53,80,.2)'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = color; ctx.fillRect(42, -3, 46, 6);
        poly([[95, -9], [108, -5], [108, 5], [95, 9]], '#CFCFD6');
        ctx.fillStyle = color; rr(106, -4, 18, 8, 4); ctx.fill();
        break;
      case 'pedzel':
        ctx.fillStyle = '#C98A4B'; rr(0, -6, 72, 12, 6); ctx.fill();
        ctx.fillStyle = C.red; rr(0, -6, 14, 12, 6); ctx.fill();
        ctx.fillStyle = '#C9CED6'; rr(68, -9, 18, 18, 3); ctx.fill();
        ctx.fillStyle = '#8A6A4A'; ctx.beginPath(); ctx.moveTo(86, -9); ctx.quadraticCurveTo(112, -11, 128, 0); ctx.quadraticCurveTo(112, 11, 86, 9); ctx.closePath(); ctx.fill();
        ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(103, -9); ctx.quadraticCurveTo(118, -6, 128, 0); ctx.quadraticCurveTo(118, 6, 103, 9); ctx.quadraticCurveTo(99, 0, 103, -9); ctx.fill();
        break;
      case 'zakreslacz':
        ctx.fillStyle = shade(color, 0.55); rr(0, -15, 94, 30, 10); ctx.fill();
        ctx.fillStyle = color; rr(0, -15, 24, 30, 8); ctx.fill();
        ctx.strokeStyle = 'rgba(59,53,80,.2)'; ctx.lineWidth = 2; rr(0, -15, 94, 30, 10); ctx.stroke();
        poly([[92, -11], [106, -9], [106, 9], [92, 11]], '#E3E3EA');
        poly([[104, -8], [116, -8], [126, 8], [104, 8]], color);
        break;
      case 'neon':
        ctx.fillStyle = C.ink; rr(0, -11, 98, 22, 8); ctx.fill();
        ctx.fillStyle = color; ctx.fillRect(14, -11, 6, 22); ctx.fillRect(26, -11, 6, 22);
        poly([[96, -8], [108, -4], [108, 4], [96, 8]], '#6E6886');
        ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = (10 + Math.sin(t * 5) * 4) * scale * DPR;
        circle(116, 0, 7, color); ctx.restore();
        circle(116, 0, 3, '#FFFFFF');
        break;
      case 'tecza': {
        const rb = ['#E53935', '#FF9800', '#FFD600', '#2E9D4F', '#1E88E5', '#8E44AD'];
        rb.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(4, -12 + i * 4, 90, 4); });
        ctx.fillStyle = '#F48FB1'; rr(0, -12, 10, 24, 4); ctx.fill();
        poly([[94, -12], [94, 12], [124, 0]], '#F2D3A2');
        const g = ctx.createLinearGradient(114, -4, 114, 4); g.addColorStop(0, '#E53935'); g.addColorStop(0.5, '#FFD600'); g.addColorStop(1, '#1E88E5');
        poly([[113, -4.5], [113, 4.5], [125, 0]], g);
        break;
      }
      case 'spray':
        ctx.fillStyle = color; rr(0, -16, 84, 32, 10); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillRect(22, -16, 36, 32);
        ctx.fillStyle = color; star(40, 0, 9, color, 5, 0.45);
        ctx.strokeStyle = 'rgba(59,53,80,.25)'; ctx.lineWidth = 2; rr(0, -16, 84, 32, 10); ctx.stroke();
        ctx.fillStyle = '#C9CED6'; ctx.beginPath(); ctx.moveTo(84, -14); ctx.quadraticCurveTo(98, -14, 98, -5); ctx.lineTo(98, 5); ctx.quadraticCurveTo(98, 14, 84, 14); ctx.fill();
        ctx.fillStyle = C.ink; rr(97, -5, 9, 10, 3); ctx.fill();
        for (const [mx, my, r] of [[114, -6, 2.5], [120, 3, 3], [128, -2, 2.5], [126, 9, 2], [134, -9, 2], [136, 5, 2.5], [113, 7, 2]]) circle(mx, my, r, color);
        break;
      case 'brokat':
        ctx.fillStyle = C.violet; rr(0, -4, 90, 8, 4); ctx.fill();
        ctx.save(); ctx.translate(108, 0); ctx.rotate(Math.sin(t * 2) * 0.15);
        star(0, 0, 20, '#FFFFFF', 5, 0.5); star(0, 0, 16, color, 5, 0.5);
        ctx.restore();
        for (const [sx, sy, ph] of [[132, -15, 0], [92, -16, 2], [130, 15, 4]]) star(sx, sy, 4 + Math.sin(t * 6 + ph) * 2.5, '#FFD34D');
        break;
      case 'wiadro':
        ctx.save(); ctx.translate(52, 2); ctx.rotate(-0.4);
        ctx.strokeStyle = '#8D93A0'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, -16, 22, Math.PI, 0); ctx.stroke();
        poly([[-26, -16], [26, -16], [20, 18], [-20, 18]], '#C9CED6');
        ellipse(0, -16, 26, 6, '#AEB4BE'); ellipse(0, -16, 21, 4, color);
        ctx.restore();
        ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(74, -10); ctx.quadraticCurveTo(92, -6, 94, 8); ctx.lineTo(86, 8); ctx.quadraticCurveTo(84, 0, 74, -2); ctx.fill();
        ellipse(104, 12, 26, 7, color);
        break;
      case 'gumka':
        ctx.save(); ctx.translate(62, 0); ctx.rotate(-0.12);
        ctx.fillStyle = '#F48FB1'; rr(-46, -16, 92, 32, 8); ctx.fill();
        ctx.fillStyle = '#64B5F6'; rr(8, -16, 38, 32, 8); ctx.fill(); ctx.fillRect(8, -16, 10, 32);
        ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fillRect(-40, -12, 80, 5);
        ctx.restore();
        for (const [cx, cy] of [[118, 12], [126, 6], [112, 16]]) circle(cx, cy, 2.5, '#F8BBD0');
        break;
      case 'naklejki':
        ctx.save(); ctx.translate(48, 0); ctx.rotate(-0.15);
        ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = 'rgba(59,53,80,.2)'; ctx.lineWidth = 2;
        rr(-28, -24, 52, 48, 12); ctx.fill(); ctx.stroke();
        drawEmoji('⭐', -2, 0, 38);
        ctx.restore();
        ctx.save(); ctx.translate(94, 0); ctx.rotate(0.1);
        ctx.fillStyle = '#FFFFFF'; rr(-28, -25, 56, 50, 12); ctx.fill(); ctx.stroke();
        drawEmoji(S.sticker, 0, 0, 42);
        poly([[28, 11], [14, 25], [28, 25]], '#E9E2F3');
        ctx.restore();
        break;
    }
  }
  // ---------- wygląd: tło, szklane panele, przyciski-cukierki ----------
  const press = {};
  const tap = (k) => { press[k] = 1; };
  const pk = (k) => 1 - (press[k] || 0) * 0.14;
  const SHADOW = 'rgba(40,20,90,.28)';
  /* miękkie plamy światła i rysuneczki w tle (losowane raz) */
  const BLOBS = [[110, 80, 280, '#FFD1F0'], [1180, 110, 300, '#9BE7FF'], [640, 760, 420, '#FFE29A'], [1000, 600, 240, '#C8B6FF'], [240, 640, 260, '#A6F0C6']];
  const DOODLES = Array.from({ length: 26 }, (_, i) => ({ x: rand(0, W), y: rand(0, H), r: rand(9, 22), k: i % 4, rot: rand(0, 6.28), sp: rand(0.25, 0.7) }));
  function heart(x, y, r, fill) {
    ctx.beginPath(); ctx.moveTo(x, y + r * 0.9);
    ctx.bezierCurveTo(x - r * 1.4, y - r * 0.1, x - r * 0.6, y - r * 1.1, x, y - r * 0.35);
    ctx.bezierCurveTo(x + r * 0.6, y - r * 1.1, x + r * 1.4, y - r * 0.1, x, y + r * 0.9);
    ctx.fillStyle = fill; ctx.fill();
  }
  function drawDesk() {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#6A5AE0'); g.addColorStop(0.55, '#A35BE8'); g.addColorStop(1, '#FF7EB3');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (const [x, y, r, c] of BLOBS) {
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, c + '99'); rg.addColorStop(1, c + '00');
      ctx.fillStyle = rg; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const white = 'rgba(255,255,255,.18)';
    ctx.save(); ctx.strokeStyle = white; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (const d of DOODLES) {
      ctx.save(); ctx.translate(d.x, d.y + Math.sin(S.time * d.sp + d.rot) * 6); ctx.rotate(d.rot + S.time * d.sp * 0.15);
      if (d.k === 0) star(0, 0, d.r, white, 5, 0.45);
      else if (d.k === 1) { ctx.beginPath(); ctx.arc(0, 0, d.r * 0.7, 0, Math.PI * 2); ctx.stroke(); }
      else if (d.k === 2) { ctx.beginPath(); ctx.moveTo(-d.r, 0); ctx.bezierCurveTo(-d.r / 2, -d.r, d.r / 2, d.r, d.r, 0); ctx.stroke(); }
      else heart(0, 0, d.r * 0.7, white);
      ctx.restore();
    }
    ctx.restore();
  }
  /* półprzezroczysty panel jak z mlecznego szkła */
  function glass(x, y, w, h, r) {
    ctx.save();
    ctx.shadowColor = SHADOW; ctx.shadowBlur = 20 * scale * DPR; ctx.shadowOffsetY = 6 * scale * DPR;
    ctx.fillStyle = 'rgba(255,255,255,.2)'; rr(x, y, w, h, r); ctx.fill();
    ctx.restore();
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(255,255,255,.32)'); g.addColorStop(1, 'rgba(255,255,255,.08)');
    ctx.fillStyle = g; rr(x, y, w, h, r); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 2; rr(x + 1, y + 1, w - 2, h - 2, r - 1); ctx.stroke();
  }
  /* wypukły, błyszczący przycisk; icon() rysuje biały znaczek w środku (0,0) */
  function candy(x, y, r, color, key, icon) {
    const s = key ? pk(key) : 1;
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    circle(0, 6, r, 'rgba(40,20,90,.25)');
    circle(0, 4, r, shade(color, -0.3));
    const g = ctx.createLinearGradient(0, -r, 0, r);
    g.addColorStop(0, shade(color, 0.3)); g.addColorStop(1, color);
    circle(0, 0, r, g);
    ctx.beginPath(); ctx.ellipse(0, -r * 0.48, r * 0.6, r * 0.28, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.38)'; ctx.fill();
    if (icon) icon();
    ctx.restore();
  }
  /* pigułka-cukierek (prostokąt z zaokrągleniem) */
  function candyRect(x, y, w, h, r, color, key, icon) {
    const s = key ? pk(key) : 1;
    ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.scale(s, s);
    ctx.fillStyle = 'rgba(40,20,90,.22)'; rr(-w / 2, -h / 2 + 6, w, h, r); ctx.fill();
    ctx.fillStyle = shade(color, -0.3); rr(-w / 2, -h / 2 + 4, w, h, r); ctx.fill();
    const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, shade(color, 0.3)); g.addColorStop(1, color);
    ctx.fillStyle = g; rr(-w / 2, -h / 2, w, h, r); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.3)'; rr(-w / 2 + 8, -h / 2 + 4, w - 16, h * 0.3, h * 0.15); ctx.fill();
    if (icon) icon();
    ctx.restore();
  }
  function drawTools() {
    glass(6, 6, 148, 704, 28);
    TOOLS.forEach((t, i) => {
      const y = TOOL_Y0 + i * TOOL_H + TOOL_H / 2, sel = i === S.tool;
      if (sel) {
        ctx.save();
        ctx.shadowColor = SHADOW; ctx.shadowBlur = 14 * scale * DPR; ctx.shadowOffsetY = 4 * scale * DPR;
        ctx.fillStyle = '#FFFFFF'; rr(12, y - TOOL_H / 2 + 4, 162, TOOL_H - 8, 20); ctx.fill();
        ctx.restore();
        const g = ctx.createLinearGradient(12, 0, 30, 0); g.addColorStop(0, '#FF7EB3'); g.addColorStop(1, '#8A6FDF');
        ctx.fillStyle = g; rr(12, y - 15, 7, 30, 3.5); ctx.fill();
      }
      const c = t.id === 'gumka' ? '#F48FB1' : col();
      const bob = sel ? Math.sin(S.time * 4) * 2 : 0, s = pk('tool' + i);
      ctx.save(); ctx.translate(sel ? 30 : 14, y + bob); ctx.scale(sel ? s : 0.9 * s, sel ? s : 0.9 * s);
      drawImpl(t.id, c);
      ctx.restore();
    });
  }

  // ---------- rysowanie: prawa kolumna ----------
  function drawRight() {
    glass(1146, 6, 122, 704, 28);
    ctx.save(); if (!undoStack.length) ctx.globalAlpha = 0.45;
    candy(BTN.undo.x, BTN.undo.y, BTN.undo.r, '#FFA620', 'undo', () => {
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 7; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(15, 13); ctx.quadraticCurveTo(17, -8, -7, -8); ctx.stroke();
      poly([[-19, -8], [-5, -20], [-5, 4]], '#FFFFFF');
    });
    ctx.restore();
    // grubość
    ctx.fillStyle = 'rgba(255,255,255,.22)'; rr(RX - 40, 90, 80, 320, 34); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 2; ctx.stroke();
    const stick = tool().id === 'naklejki';
    const c = NO_COLOR.has(tool().id) ? C.ink : col();
    for (let i = 0; i < 5; i++) {
      const b = sizeBtn(i), sel = i === S.size, s = pk('size' + i);
      ctx.save(); ctx.translate(b.x, b.y); ctx.scale(s, s);
      if (sel) {
        ctx.save(); ctx.shadowColor = SHADOW; ctx.shadowBlur = 10 * scale * DPR; ctx.shadowOffsetY = 3 * scale * DPR;
        circle(0, 0, b.r + 2, '#FFFFFF'); ctx.restore();
      }
      if (stick) drawEmoji(S.sticker, 0, 0, 18 + i * 8);
      else {
        circle(0, 0, [3, 6, 9.5, 14, 20][i], c);
        if (c === '#FFFFFF' || !sel) { ctx.strokeStyle = sel ? '#D8CFE6' : 'rgba(255,255,255,.85)'; ctx.lineWidth = 2; ctx.stroke(); }
      }
      ctx.restore();
    }
    candy(BTN.nowa.x, BTN.nowa.y, BTN.nowa.r, '#22C08A', 'nowa', () => sheetIcon(1, '#22C08A'));
    candy(BTN.zapisz.x, BTN.zapisz.y, BTN.zapisz.r, '#FF5A6E', 'zapisz', () => {
      ctx.fillStyle = '#FFFFFF'; rr(-8, -18, 16, 8, 3); ctx.fill(); rr(-21, -12, 42, 28, 8); ctx.fill();
      circle(0, 2, 10, '#FF5A6E'); circle(0, 2, 6, '#FFFFFF'); circle(0, 2, 3.5, '#FF5A6E'); circle(14, -6, 2.5, '#FF5A6E');
    });
    candy(BTN.galeria.x, BTN.galeria.y, BTN.galeria.r, '#3D9BFF', 'galeria', () => {
      ctx.fillStyle = '#FFFFFF'; rr(-21, -16, 42, 32, 6); ctx.fill();
      ctx.fillStyle = '#BFE3FA'; rr(-16, -11, 32, 22, 3); ctx.fill();
      circle(8, -4, 4, '#FFC93C');
      poly([[-16, 11], [-6, -1], [2, 7], [7, 2], [16, 11]], '#3BB273');
    });
    drawSoundBtn();
  }
  /* kartka z zagiętym rogiem i plusem */
  function sheetIcon(s, plus) {
    ctx.save(); ctx.scale(s, s);
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.moveTo(-14, -19); ctx.lineTo(6, -19); ctx.lineTo(14, -11); ctx.lineTo(14, 19); ctx.lineTo(-14, 19); ctx.closePath(); ctx.fill();
    poly([[6, -19], [6, -11], [14, -11]], 'rgba(40,20,90,.18)');
    ctx.strokeStyle = plus; ctx.lineWidth = 4.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(0, 10); ctx.moveTo(-7, 3); ctx.lineTo(7, 3); ctx.stroke();
    ctx.restore();
  }
  function drawFrameIcon(x, y, s) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.fillStyle = '#C98A4B'; rr(-22, -18, 44, 36, 5); ctx.fill();
    ctx.fillStyle = '#BFE3FA'; ctx.fillRect(-16, -12, 32, 24);
    circle(8, -5, 4, '#FFD34D');
    poly([[-16, 12], [-6, -1], [2, 7], [7, 2], [16, 12]], '#5FB36B');
    ctx.restore();
  }
  function drawSoundBtn() {
    const b = BTN.sound;
    candy(b.x, b.y, b.r, '#9B7BFF', 'sound', () => {
      ctx.save(); ctx.translate(-3, 0); ctx.scale(0.62, 0.62);
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath(); ctx.moveTo(-14, -6); ctx.lineTo(-6, -6); ctx.lineTo(4, -15); ctx.lineTo(4, 15); ctx.lineTo(-6, 6); ctx.lineTo(-14, 6); ctx.fill();
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath();
      if (soundOn) { ctx.arc(6, 0, 8, -0.9, 0.9); ctx.moveTo(6 + Math.cos(-0.9) * 14, Math.sin(-0.9) * 14); ctx.arc(6, 0, 14, -0.9, 0.9); }
      else { ctx.moveTo(10, -8); ctx.lineTo(22, 8); ctx.moveTo(22, -8); ctx.lineTo(10, 8); }
      ctx.stroke();
      ctx.restore();
    });
  }

  // ---------- rysowanie: dolny pasek (plamy farby) ----------
  /* każda plama ma swój nieregularny kształt */
  const BLOB_SHAPES = COLORS.map(() => Array.from({ length: 9 }, () => rand(0.88, 1.08)));
  function paintBlob(x, y, r, c, shape) {
    const n = shape.length, pts = shape.map((k, i) => {
      const a = (i / n) * Math.PI * 2;
      return [x + Math.cos(a) * r * k, y + Math.sin(a) * r * k];
    });
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const [ax, ay] = pts[i % n], [bx, by] = pts[(i + 1) % n], mx = (ax + bx) / 2, my = (ay + by) / 2;
      if (i === 0) ctx.moveTo(mx, my); else ctx.quadraticCurveTo(ax, ay, mx, my);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r * 1.1);
    g.addColorStop(0, c === '#FFFFFF' ? '#FFFFFF' : shade(c, 0.35)); g.addColorStop(1, c === '#FFFFFF' ? '#E4DDF0' : c);
    ctx.fillStyle = g; ctx.fill();
    ellipse(x - r * 0.32, y - r * 0.38, r * 0.28, r * 0.16, 'rgba(255,255,255,.65)', -0.5);
  }
  function drawBar() {
    glass(BAR.x, BAR.y, BAR.w, BAR.h, 28);
    if (tool().id === 'naklejki') {
      const o = STICKER_OPEN;
      candyRect(o.x, o.y, o.w, o.h, 20, '#7C5CFF', 'open', () => {
        ctx.fillStyle = 'rgba(255,255,255,.92)'; rr(-o.w / 2 + 9, -o.h / 2 + 9, o.w - 18, o.h - 18, 12); ctx.fill();
        [['🐶', -24, -13], ['🚗', 24, -13], ['🌸', -24, 13], ['⭐', 24, 13]].forEach(([em, dx, dy]) => drawEmoji(em, dx, dy, 27));
      });
      S.recent.forEach((em, i) => {
        const b = recentSpot(i), sel = em === S.sticker, s = pk('rec' + i);
        ctx.save(); ctx.translate(b.x, b.y); ctx.scale(s, s);
        if (sel) {
          ctx.save(); ctx.shadowColor = SHADOW; ctx.shadowBlur = 10 * scale * DPR; ctx.shadowOffsetY = 3 * scale * DPR;
          circle(0, 0, b.r + 4, '#FFFFFF'); ctx.restore();
        }
        drawEmoji(em, 0, sel ? Math.sin(S.time * 5) * 2 : 0, sel ? 52 : 46);
        ctx.restore();
      });
      return;
    }
    const dim = NO_COLOR.has(tool().id);
    COLORS.forEach(([c], i) => {
      const b = swatch(i), sel = i === S.color && !dim, s = pk('col' + i);
      const r = sel ? b.r + 5 : b.r, lift = sel ? Math.abs(Math.sin(S.time * 3.5)) * 5 + 4 : 0;
      ctx.save(); if (dim) ctx.globalAlpha = 0.5;
      ctx.translate(b.x, b.y); ctx.scale(s, s);
      ellipse(0, r * 0.85, r * 0.8, r * 0.22, 'rgba(40,20,90,.22)');
      if (sel) { circle(0, -lift, r + 6, '#FFFFFF'); }
      paintBlob(0, -lift, r, c, BLOB_SHAPES[i]);
      ctx.restore();
    });
  }

  // ---------- rysowanie: kartka ----------
  /* kawałek taśmy washi */
  function tape(x, y, rot, c) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.fillStyle = c; ctx.globalAlpha = 0.88;
    ctx.beginPath(); ctx.moveTo(-42, -14);
    for (let i = 0; i <= 6; i++) ctx.lineTo(-42 + i * 14, -14 + (i % 2 ? 3 : 0));
    ctx.lineTo(42, 14);
    for (let i = 6; i >= 0; i--) ctx.lineTo(-42 + i * 14, 14 - (i % 2 ? 3 : 0));
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 0.35; ctx.fillStyle = '#FFFFFF';
    for (let i = -3; i <= 3; i++) ctx.fillRect(i * 12 - 2, -12, 5, 24);
    ctx.restore();
  }
  function drawPaper() {
    ctx.save();
    ctx.shadowColor = 'rgba(40,20,90,.38)'; ctx.shadowBlur = 28 * scale * DPR; ctx.shadowOffsetY = 10 * scale * DPR;
    ctx.fillStyle = S.paper; rr(PAPER.x, PAPER.y, PAPER.w, PAPER.h, 6); ctx.fill();
    ctx.restore();
    ctx.save(); rr(PAPER.x, PAPER.y, PAPER.w, PAPER.h, 6); ctx.clip();
    ctx.drawImage(paint, PAPER.x, PAPER.y, PAPER.w, PAPER.h);
    const s = S.stroke;
    if (s && s.t.id !== 'gumka') {
      ctx.save(); ctx.globalAlpha = s.t.alpha; ctx.drawImage(strokeC, PAPER.x, PAPER.y, PAPER.w, PAPER.h); ctx.restore();
    }
    ctx.restore();
    tape(PAPER.x + 18, PAPER.y + 12, -0.75, '#FF9EC4');
    tape(PAPER.x + PAPER.w - 18, PAPER.y + 12, 0.75, '#8ED8FF');
  }
  /* podgląd: naklejka pod palcem, kółko gumki, kursor myszy */
  function drawPreview() {
    if (S.place) {
      const sz = STICKER_SIZES[S.size] * 1.12, bob = Math.sin(S.time * 8) * 3;
      ctx.save(); ctx.globalAlpha = 0.25; ellipse(S.place.x, S.place.y + sz * 0.42, sz * 0.32, sz * 0.08, C.ink); ctx.restore();
      ctx.save(); ctx.translate(S.place.x, S.place.y - 6 + bob); ctx.rotate(Math.sin(S.time * 5) * 0.06);
      ctx.drawImage(bigSticker(S.sticker), -sz / 2, -sz / 2, sz, sz);
      ctx.restore();
      return;
    }
    const s = S.stroke;
    let p = null, w = 0;
    if (s && (s.t.id === 'gumka' || s.t.id === 'spray')) { p = toWorldP(s.pos); w = s.w / RES; }
    else if (!s && S.hover && inRect(S.hover, PAPER) && !S.drawer && !S.popup) {
      const t = tool();
      if (t.id === 'naklejki') {
        ctx.save(); ctx.globalAlpha = 0.45; const sz = STICKER_SIZES[S.size];
        ctx.drawImage(bigSticker(S.sticker), S.hover.x - sz / 2, S.hover.y - sz / 2, sz, sz); ctx.restore();
        return;
      }
      if (t.w) { p = S.hover; w = Math.max(2 / RES, SIZES[S.size] * t.w); }
    }
    if (!p) return;
    ctx.save();
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(3, w / 2), 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 4; ctx.stroke();
    ctx.strokeStyle = 'rgba(59,53,80,.7)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
  }

  // ---------- rysowanie: szuflada z naklejkami ----------
  const TAB_COLORS = ['#FFA620', '#FF7A45', '#3D9BFF', '#22C08A', '#FF5A6E', '#7C5CFF', '#FF4FA3', '#FFC23C', '#9B7BFF'];
  function card(x, y, w, h, r) {
    ctx.save();
    ctx.shadowColor = 'rgba(40,20,90,.4)'; ctx.shadowBlur = 30 * scale * DPR; ctx.shadowOffsetY = 10 * scale * DPR;
    ctx.fillStyle = '#FFFFFF'; rr(x, y, w, h, r); ctx.fill();
    ctx.restore();
  }
  function closeBtn(b) {
    candy(b.x, b.y, b.r, '#FF5A6E', 'close', () => {
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-9, -9); ctx.lineTo(9, 9); ctx.moveTo(9, -9); ctx.lineTo(-9, 9); ctx.stroke();
    });
  }
  function drawDrawer() {
    ctx.fillStyle = 'rgba(40,20,90,.35)'; ctx.fillRect(0, 0, W, H);
    card(DR.x, DR.y, DR.w, DR.h, 34);
    // pasek kategorii w kolorze wybranej zakładki
    ctx.save(); rr(DR.x, DR.y, DR.w, DR.h, 34); ctx.clip();
    ctx.fillStyle = shade(TAB_COLORS[S.cat], 0.82); ctx.fillRect(DR.x, DR.y, DR.w, 96);
    ctx.restore();
    CATS.forEach((c, i) => {
      const x = TAB_X0 + i * TAB_STEP, sel = i === S.cat, w = TAB_STEP - 10;
      if (sel) candyRect(x, TAB_Y - 4, w, TAB_H, 20, TAB_COLORS[i], 'tab' + i, () => drawEmoji(c.icon, 0, Math.sin(S.time * 4) * 2, 52));
      else {
        ctx.fillStyle = 'rgba(255,255,255,.75)'; rr(x, TAB_Y + 4, w, TAB_H - 8, 18); ctx.fill();
        drawEmoji(c.icon, x + w / 2, TAB_Y + TAB_H / 2, 40);
      }
    });
    closeBtn(DR_CLOSE);
    CATS[S.cat].items.forEach(([em], i) => {
      const cx = GRID_X0 + (i % GRID_COLS) * CELL_W + CELL_W / 2, cy = GRID_Y0 + Math.floor(i / GRID_COLS) * CELL_H + CELL_H / 2;
      if (em === S.sticker) { circle(cx, cy, 40, shade(TAB_COLORS[S.cat], 0.8)); }
      drawEmoji(em, cx, cy + Math.sin(S.time * 3 + i) * 1.5, 66);
    });
  }

  // ---------- rysowanie: wybór nowej kartki ----------
  function drawPopup() {
    ctx.fillStyle = 'rgba(40,20,90,.35)'; ctx.fillRect(0, 0, W, H);
    card(POP.x, POP.y, POP.w, POP.h, 34);
    candy(POP.x + POP.w / 2, POP.y + 64, 40, '#22C08A', null, () => sheetIcon(1.05, '#22C08A'));
    PAPERS.forEach(([c], i) => {
      const r = sheet(i), lift = Math.sin(S.time * 3 + i * 0.8) * 3, rot = (i % 2 ? 1 : -1) * 0.05;
      ctx.save(); ctx.translate(r.x + r.w / 2, r.y + r.h / 2 + lift); ctx.rotate(rot);
      ctx.fillStyle = 'rgba(40,20,90,.18)'; rr(-r.w / 2 + 3, -r.h / 2 + 6, r.w, r.h, 8); ctx.fill();
      ctx.fillStyle = c; rr(-r.w / 2, -r.h / 2, r.w, r.h, 8); ctx.fill();
      ctx.strokeStyle = '#E4DDF0'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = i % 2 ? '#8ED8FF' : '#FF9EC4'; ctx.globalAlpha = 0.85; ctx.fillRect(-14, -r.h / 2 - 7, 28, 13);
      ctx.restore();
    });
  }

  // ---------- rysowanie: galeria ----------
  function galCards() {
    return S.gallery.slice(S.galPage * 8, S.galPage * 8 + 8).map((g, i) => ({
      g, i, x: GAL.x0 + (i % GAL.cols) * (GAL.cw + GAL.gx), y: GAL.y0 + Math.floor(i / GAL.cols) * (GAL.ch + GAL.gy),
    }));
  }
  function drawGallery() {
    candy(GAL_BACK.x, GAL_BACK.y, GAL_BACK.r, '#FF7A45', 'back', () => {
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(15, 0); ctx.lineTo(-14, 0); ctx.moveTo(-2, -14); ctx.lineTo(-16, 0); ctx.lineTo(-2, 14); ctx.stroke();
    });
    ctx.save(); ctx.translate(W / 2 - 160, 58); ctx.rotate(-0.08); drawFrameIcon(0, 0, 1.4); ctx.restore();
    ctx.font = `700 50px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(40,20,90,.3)'; ctx.fillText('Moje rysunki', W / 2 - 118, 64);
    ctx.fillStyle = '#FFFFFF'; ctx.fillText('Moje rysunki', W / 2 - 118, 60);
    if (S.galLoading) {
      for (let i = 0; i < 3; i++) circle(W / 2 - 30 + i * 30, H / 2, 9 + Math.sin(S.time * 6 - i) * 3, '#FFFFFF');
      return;
    }
    if (!S.gallery.length) {
      ctx.save(); ctx.translate(W / 2, H / 2 + 10); ctx.rotate(Math.sin(S.time * 2) * 0.05);
      drawFrameIcon(0, 0, 4.5); ctx.restore();
      return;
    }
    // zdjęcia jak polaroidy przyklejone taśmą
    for (const { g, i, x, y } of galCards()) {
      const cur = g.rec.id === S.galleryId, rot = [-0.03, 0.02, -0.015, 0.03][i % 4];
      ctx.save(); ctx.translate(x + GAL.cw / 2, y + GAL.ch / 2); ctx.rotate(rot); ctx.translate(-GAL.cw / 2, -GAL.ch / 2);
      card(0, 0, GAL.cw, GAL.ch, 12);
      if (cur) { ctx.strokeStyle = '#FFC23C'; ctx.lineWidth = 6; rr(-3, -3, GAL.cw + 6, GAL.ch + 6, 14); ctx.stroke(); }
      ctx.save(); rr(10, 10, 260, 156, 6); ctx.clip();
      ctx.fillStyle = g.rec.paper; ctx.fillRect(10, 10, 260, 156);
      if (g.img.complete && g.img.naturalWidth) ctx.drawImage(g.img, 10, 10, 260, 156);
      ctx.restore();
      tape(GAL.cw / 2, -2, (i % 2 ? 0.06 : -0.06), i % 2 ? '#8ED8FF' : '#FF9EC4');
      const dy = 186;
      candy(40, dy, 17, '#3D9BFF', 'dl' + g.rec.id, () => {
        ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 3.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(0, 3); ctx.moveTo(-6, -3); ctx.lineTo(0, 3); ctx.lineTo(6, -3);
        ctx.moveTo(-8, 8); ctx.lineTo(8, 8); ctx.stroke();
      });
      const conf = S.galConfirm && S.galConfirm.id === g.rec.id;
      ctx.save(); ctx.translate(GAL.cw - 40, dy); if (conf) ctx.rotate(Math.sin(S.time * 25) * 0.12);
      if (conf) {
        candy(0, 0, 21, '#E5312F', null, () => {
          ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(-2, 8); ctx.lineTo(10, -7); ctx.stroke();
        });
      } else {
        candy(0, 0, 17, '#B9AED0', null, () => {
          ctx.fillStyle = '#FFFFFF'; ctx.fillRect(-8, -8, 16, 3); ctx.fillRect(-3, -11, 6, 3);
          ctx.beginPath(); ctx.moveTo(-6, -3); ctx.lineTo(6, -3); ctx.lineTo(4.5, 9); ctx.lineTo(-4.5, 9); ctx.closePath(); ctx.fill();
        });
      }
      ctx.restore();
      ctx.restore();
    }
    const pages = Math.ceil(S.gallery.length / 8);
    if (pages > 1) {
      for (const [b, dir, key] of [[GAL_PREV, -1, 'prev'], [GAL_NEXT, 1, 'next']]) {
        candy(b.x, b.y, b.r, '#7C5CFF', key, () => {
          ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.beginPath(); ctx.moveTo(-5 * dir, -12); ctx.lineTo(7 * dir, 0); ctx.lineTo(-5 * dir, 12); ctx.stroke();
        });
      }
      for (let i = 0; i < pages; i++) circle(W / 2 - (pages - 1) * 11 + i * 22, GAL_PREV.y, i === S.galPage ? 8 : 5, i === S.galPage ? '#FFFFFF' : 'rgba(255,255,255,.45)');
    }
  }

  // ---------- rysowanie: ekran tytułowy ----------
  function drawTitle() {
    ctx.fillStyle = 'rgba(40,20,90,.3)'; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(W / 2, 306); ctx.rotate(-0.015);
    card(-330, -210, 660, 420, 44);
    ctx.restore();
    tape(W / 2 - 300, 104, -0.6, '#FF9EC4');
    tape(W / 2 + 300, 104, 0.6, '#8ED8FF');
    const fan = [['kredka', '#E53935', -0.5], ['flamaster', '#1E88E5', -0.17], ['pedzel', '#2E9D4F', 0.17], ['olowek', '#FF9800', 0.5]];
    fan.forEach(([id, c, a], i) => {
      ctx.save(); ctx.translate(W / 2, 250); ctx.rotate(-Math.PI / 2 + a + Math.sin(S.time * 2 + i) * 0.04);
      ctx.translate(30, 0); ctx.scale(0.85, 0.85); drawImpl(id, c); ctx.restore();
    });
    const word = 'Rysowanka', cols = ['#FF5A6E', '#FF8A00', '#F5B700', '#22B573', '#2D8CFF', '#7C5CFF', '#FF4FA3', '#00B8A9', '#FF7A45'];
    ctx.font = `700 98px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const total = ctx.measureText(word).width;
    let x = W / 2 - total / 2;
    [...word].forEach((ch, i) => {
      const y = 302 + Math.sin(S.time * 3 + i * 0.6) * 6, w = ctx.measureText(ch).width;
      ctx.save(); ctx.translate(x + w / 2, y); ctx.rotate(Math.sin(S.time * 2 + i) * 0.06);
      ctx.fillStyle = shade(cols[i], -0.35); ctx.fillText(ch, -w / 2, 5);
      ctx.fillStyle = cols[i]; ctx.fillText(ch, -w / 2, 0);
      ctx.restore();
      x += w;
    });
    drawEmoji('🦄', W / 2 - 220, 430 + Math.sin(S.time * 2) * 5, 88);
    drawEmoji('🌈', W / 2 + 220, 430 + Math.sin(S.time * 2 + 1) * 5, 84);
    const s = 1 + Math.sin(S.time * 4) * 0.05;
    ctx.save(); ctx.translate(PLAY_BTN.x, PLAY_BTN.y); ctx.scale(s, s);
    candy(0, 0, PLAY_BTN.r, '#7C5CFF', null, () => {
      ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.moveTo(-18, -30); ctx.lineTo(34, 0); ctx.lineTo(-18, 30); ctx.closePath(); ctx.fill();
    });
    ctx.restore();
  }

  function drawParts() {
    for (const p of parts) {
      ctx.save(); ctx.globalAlpha = clamp(1 - p.life / p.max, 0, 1);
      if (p.star) star(p.x, p.y, p.sz, p.col, 4, 0.35); else circle(p.x, p.y, p.sz * 0.6, p.col);
      ctx.restore();
    }
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.desk; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(DPR * scale, 0, 0, DPR * scale, DPR * offX, DPR * offY);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    drawDesk();
    if (S.scene === 'gallery') {
      drawGallery();
      drawSoundBtn();
    } else {
      drawPaper();
      ctx.save(); ctx.beginPath(); ctx.rect(PAPER.x, PAPER.y, PAPER.w, PAPER.h); ctx.clip();
      drawPreview();
      ctx.restore();
      drawTools();
      drawRight();
      drawBar();
      for (const f of fx) f.draw(clamp(f.t / f.dur, 0, 1));
      if (S.drawer) drawDrawer();
      if (S.popup) drawPopup();
      if (S.scene === 'title') drawTitle();
    }
    drawParts();
    ctx.restore();
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    update(dt); draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------- do testów w konsoli ----------
  const toolIdx = (id) => TOOLS.findIndex((t) => t.id === id);
  window.__rysowanka = {
    S, TOOLS, CATS, ready: dbReady,
    step(sec) { for (let t = 0; t < sec; t += 1 / 60) update(1 / 60); draw(); },
    startGame() { start(); },
    tool(id) { selectTool(toolIdx(id)); },
    color(i) { selectColor(i); },
    size(i) { selectSize(i); },
    /* kreska przez punkty w jednostkach świata, np. line([{x:300,y:200},{x:600,y:300}]) */
    line(points) {
      beginStroke(points[0], -1);
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        walk(a, b, 8, (x, y) => { if (S.stroke) extendStroke(toPaper({ x, y })); });
      }
      endStroke();
    },
    fill(x, y) { fillAt({ x, y }); },
    sticker(em, x, y) { S.sticker = em; stamp(em, { x, y }); },
    undo() { undo(); },
    save() { return onSave(); },
    gallery() { return openGallery(); },
    newPage(c = '#FFFFFF') { return newPage(c); },
  };
})();
