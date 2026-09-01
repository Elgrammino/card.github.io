/* ============================================================
   Живой фон: 3D-«хаос» из падающих карт.
   Портирован из media/хаос карт/Card Deck Background.html:
   карты сыплются сверху вразнобой — у каждой свой снос, своя
   скорость и свой кувырок. Фаза привязана к прокрутке страницы
   (0 — верх, 1 — низ); при скролле вверх карты так же плавно
   отматываются назад. Остановка скролла — остановка падения,
   рисунок по пути не повторяется.

   Раньше здесь была спираль-«пружина»; сменили только характер
   движения — всё остальное (сглаживание прокрутки, пауза на
   скрытой вкладке, статичный кадр для reduced-motion / ?static,
   откат на CSS-карты) осталось прежним.

   Отличия от демо (по ТЗ проекта):
   - узкое поле под колонку-визитку, карты чуть мельче и дальше;
   - немного карт — ради FPS на телефоне;
   - текстуры — сильно уменьшенные копии media/card/*.jpg (108×162);
   - материалы подкрашены под тёмно-тёплую палитру сайта;
   - three.js подключён локально (assets/deck/three.module.min.js);
   - лёгкий общий дрейф поля в покое (DRIFT), выключается константой;
   - prefers-reduced-motion ИЛИ ?static → один статичный кадр;
   - рендер останавливается, когда вкладка скрыта.

   Если WebGL недоступен или упал импорт — модуль тихо выходит,
   на фоне остаются прежние CSS-карты .deco (класс .deck-on не
   вешается). Это штатный откат.
   ============================================================ */
import * as THREE from './three.module.min.js';

const host = document.getElementById('deckBg');
if (host) boot();

function boot(){
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const STATIC  = REDUCED || /[?&]static\b/.test(location.search);

  /* ---- настройки эффекта (крутить здесь) ---- */
  const CARDS      = 26;      // всего карт в поле
  const SPAN       = 2.30;    // путь карты по вертикали до возврата наверх
  const FIELD_W    = 0.44;    // разброс по горизонтали — узко, под колонку
  const FIELD_D    = 0.42;    // разброс по глубине — даёт параллакс
  const FALLS      = 1.15;    // прокрутка всей страницы ≈ один проход поля
  const CARD_W = 0.112, CARD_H = 0.160, CARD_T = 0.0016;   // карты мельче/дальше
  const SMOOTH     = 0.0375;  // сглаживание прокрутки — как было у спирали
  const TUMBLE     = 0.85;    // общий множитель кувырка карт
  const GUST       = 0.30;    // насколько рывок скролла подкручивает всё поле
  const CAM_Z      = 1.94;    // отдаление камеры
  const FACE_EVERY = 5;       // каждая 5-я карта — «лицо» → ~20% лиц, 80% рубашек
  const DRIFT      = false;   // лёгкое покачивание всего поля в покое

  /* ---- рендерер ---- */
  let renderer;
  try{
    renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true, powerPreference:'low-power' });
  }catch(e){ return; }               // нет WebGL → откат на CSS-карты
  if (!renderer || !renderer.getContext()) return;

  renderer.setClearAlpha(0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  host.appendChild(renderer.domElement);

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 20);
  camera.position.set(0.02, 0.06, CAM_Z);
  camera.lookAt(0, 0, 0);

  /* ---- свет: тёплый, приглушённый, в тон палитре ---- */
  scene.add(new THREE.HemisphereLight(0xf2e3d0, 0x181310, 0.55));
  const key = new THREE.DirectionalLight(0xffe4c8, 1.15);
  key.position.set(0.7, 1.3, 1.1);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xd43c26, 0.35);   // --accent
  rim.position.set(-1.0, -0.2, -0.7);
  scene.add(rim);

  /* ---- текстуры (маленькие копии media/card/*) ---- */
  const texLoader = new THREE.TextureLoader();
  const load = (name) => {
    const t = texLoader.load(new URL(name, import.meta.url).href);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 2;
    return t;
  };
  const backTex  = load('back.jpg');
  const face1Tex = load('face1.jpg');
  const face2Tex = load('face2.jpg');

  /* ---- материалы: подкрашены под тёмно-тёплую палитру ---- */
  const matBack = new THREE.MeshStandardMaterial({
    map:backTex, color:0xcabfb3, roughness:0.72, metalness:0.04 });
  const matEdge = new THREE.MeshStandardMaterial({
    color:0x6f655c, roughness:0.9, metalness:0.0 });
  const matFace1 = new THREE.MeshStandardMaterial({
    map:face1Tex, color:0xece4d6, roughness:0.82, metalness:0.0 });   // 2♠ — ч/б
  const matFace2 = new THREE.MeshStandardMaterial({
    map:face2Tex, color:0xffffff, roughness:0.8,  metalness:0.0 });   // Q♥ — цветная, не глушим

  const geo  = new THREE.BoxGeometry(CARD_W, CARD_H, CARD_T);
  const deck = new THREE.Group();
  deck.name = 'card-chaos';
  scene.add(deck);

  /* детерминированный псевдо-рандом: поле стабильно между перезагрузками,
     но без видимого узора (LCG, как в демо) */
  let seed = 20260901;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

  const cards = [];
  let faceN = 0;
  for (let i = 0; i < CARDS; i++){
    const isFace = (i % FACE_EVERY === 0);
    const faceMat = isFace ? (faceN++ % 2 ? matFace2 : matFace1) : matBack;
    // порядок граней BoxGeometry: +x -x +y -y +z(лицо) -z(рубашка)
    const m = new THREE.Mesh(geo, [matEdge, matEdge, matEdge, matEdge, faceMat, matBack]);
    m.name = 'card-' + String(i + 1).padStart(2, '0');
    m.userData = {
      x: (rnd() * 2 - 1) * FIELD_W * 0.5,
      z: (rnd() * 2 - 1) * FIELD_D * 0.5,
      offset: rnd(),                     // где в падении стартует — неровные зазоры
      speed: 0.62 + rnd() * 0.85,        // у каждой карты свой темп
      drift: (rnd() * 2 - 1) * 0.08,     // боковой снос по ходу падения
      spinX: (rnd() * 2 - 1) * 1.30,
      spinY: (rnd() * 2 - 1) * 1.90,
      spinZ: (rnd() * 2 - 1) * 0.95,
      tilt0: rnd() * Math.PI * 2,        // стартовый разворот
      wobble: 0.5 + rnd() * 1.4,         // частота бокового покачивания
    };
    cards.push(m); deck.add(m);
  }

  const frac  = v => v - Math.floor(v);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* progress — сглаженная фаза прокрутки; gust — отголосок рывка скролла */
  function layout(progress, gust){
    for (let i = 0; i < CARDS; i++){
      const c = cards[i], u = c.userData;
      const t = frac(u.offset + progress * u.speed);   // 0 сверху, 1 за нижним краем
      const wob = Math.sin(u.tilt0 + t * Math.PI * 2 * u.wobble);
      c.position.set(u.x + u.drift * wob, SPAN * (0.5 - t), u.z);
      c.rotation.set(
        u.tilt0        + t * u.spinX * TUMBLE * Math.PI * 2 + gust * 0.6,
        u.tilt0 * 1.7  + t * u.spinY * TUMBLE * Math.PI * 2,
        u.tilt0 * 0.6  + t * u.spinZ * TUMBLE * Math.PI * 2 + gust
      );
      // у самых краёв кадра карта «съезжается» в точку — без хлопка появления
      const s = clamp(Math.min(t * 12, (1 - t) * 9), 0, 1);
      c.visible = s > 0.001;
      c.scale.setScalar(0.55 + 0.45 * s);
    }
  }

  /* ---- прогресс от прокрутки страницы ---- */
  let target = 0, current = 0, gust = 0, frame = 0;
  function scrollProgress(){
    const max = document.documentElement.scrollHeight - window.innerHeight;
    return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
  }
  addEventListener('scroll', () => { target = scrollProgress() * FALLS; }, { passive:true });

  function resize(){
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight || window.innerHeight);
    renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // узкая портретная колонка — чуть отъезжаем, чтобы поле влезало по высоте
    camera.position.z = CAM_Z * Math.max(1, 0.42 / camera.aspect);
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0, 0);
  }
  addEventListener('resize', resize, { passive:true });
  resize();

  function render(now){
    layout(current, gust);
    deck.rotation.y = DRIFT ? Math.sin(now * 0.00013) * 0.03 : 0;
    renderer.render(scene, camera);
  }

  if (STATIC){
    target = current = 0.18 * FALLS;          // несколько карт на середине падения
    render(0);
    // держим кадр корректным при повороте экрана
    addEventListener('resize', () => render(0), { passive:true });
  } else {
    target = current = scrollProgress() * FALLS;
    const loop = () => {
      const now = performance.now();
      const diff = target - current;
      current += diff * SMOOTH;
      // рывок скролла слегка подкручивает всё поле; сильно сглажен и
      // ограничен — чтобы не вернуть «дрожь» при быстрой прокрутке
      gust += (clamp(diff * 26, -0.8, 0.8) * GUST - gust) * 0.06;
      const moving = Math.abs(diff) > 0.0004 || Math.abs(gust) > 0.002;
      frame++;
      if (!moving && (frame & 1)) return;     // в покое — вполовину кадров
      render(now);
    };
    renderer.setAnimationLoop(loop);
    document.addEventListener('visibilitychange', () => {
      renderer.setAnimationLoop(document.hidden ? null : loop);
    });
  }

  // сцена поднялась — прячем прежние CSS-карты
  document.querySelector('.phone')?.classList.add('deck-on');
}
