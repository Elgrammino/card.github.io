/* ============================================================
   Живой фон: 3D-«пружина» из падающих карт.
   Портирован из media/Падающие карты на сайт/CardSpring.html:
   карты срываются с колоды и уходят вниз по спирали, фаза
   привязана к прокрутке страницы (0 — верх, 1 — низ). При
   скролле вверх карты так же плавно возвращаются.

   Отличия от демо (по ТЗ):
   - заметно медленнее и мягче (SMOOTH ниже, витков меньше);
   - шире — спираль частично уходит за края колонки («враскид»);
   - меньше карт в кадре (6–9) и меньше всего — ради FPS на телефоне;
   - текстуры — сильно уменьшенные копии media/card/*.jpg
     (низкое разрешение намеренно: читается как блюр за контентом);
   - материалы подкрашены под палитру сайта;
   - three.js подключён локально (assets/deck/three.module.min.js);
   - лёгкий дрейф в покое (DRIFT), выключается одной константой;
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
  const CARDS     = 22;     // всего карт в пружине
  const IN_FLIGHT = 8;      // сколько одновременно «в полёте» (≈ карт в кадре)
  const TURNS     = 2.6;    // витков спирали за проход
  const RADIUS    = 0.44;   // радиус спирали (демо 0.30) — шире, уходит за края
  const Y_TOP     = 0.98;
  const Y_BOTTOM  = -1.14;
  const CARD_W = 0.135, CARD_H = 0.193, CARD_T = 0.0018;
  const SMOOTH    = 0.05;   // сглаживание прокрутки (демо 0.09) — плавнее/медленнее
  const SPIN      = 0.30;   // доворот всей колоды от прогресса (демо 0.50)
  const FACE_EVERY = 4;     // каждая 4-я карта — «лицо» → ~25% лиц, 75% рубашек
  const DRIFT     = true;   // лёгкое покачивание пружины в покое

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
  camera.position.set(0.02, 0.06, 1.62);
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
  deck.name = 'card-spring';
  scene.add(deck);

  const cards = [];
  let faceN = 0;
  for (let i = 0; i < CARDS; i++){
    const isFace = (i % FACE_EVERY === 0);
    const faceMat = isFace ? (faceN++ % 2 ? matFace2 : matFace1) : matBack;
    // порядок граней BoxGeometry: +x -x +y -y +z(лицо) -z(рубашка)
    const m = new THREE.Mesh(geo, [matEdge, matEdge, matEdge, matEdge, faceMat, matBack]);
    m.name = 'card-' + String(i + 1).padStart(2, '0');
    cards.push(m); deck.add(m);
  }

  const ease = t => t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2) / 2;

  function place(card, i, t){
    if (t <= 0){                              // ещё в стопке над кадром
      card.visible = t > -0.85;
      card.position.set(0, Y_TOP + 0.14 + i*CARD_T*1.5 + t*0.45, 0);
      card.rotation.set(-1.35, 0, 0.02*Math.sin(i));
      return;
    }
    if (t >= 1){ card.visible = false; return; }
    card.visible = true;
    const e = ease(t);
    const spread = Math.min(1, t*3.0);       // радиус раскрывается по мере схода
    const a = t*Math.PI*2*TURNS + i*0.37;
    const r = RADIUS*spread;
    card.position.set(
      Math.sin(a)*r,
      Y_TOP - e*(Y_TOP - Y_BOTTOM),
      Math.cos(a)*r*0.8
    );
    card.rotation.set(
      -1.35 + spread*(1.35 - 0.55) + Math.sin(a*1.3)*0.2,
      -a + Math.PI/2,
      Math.sin(a*0.8 + i)*0.26
    );
  }

  /* ---- прогресс от прокрутки страницы ---- */
  let target = 0, current = 0, frame = 0;
  function scrollProgress(){
    const max = document.documentElement.scrollHeight - window.innerHeight;
    return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
  }
  addEventListener('scroll', () => { target = scrollProgress(); }, { passive:true });

  function resize(){
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight || window.innerHeight);
    renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // узкая портретная колонка — чуть отъезжаем, чтобы спираль влезала по высоте
    camera.position.z = 1.62 * Math.max(1, 0.42 / camera.aspect);
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0, 0);
  }
  addEventListener('resize', resize, { passive:true });
  resize();

  function frameCards(p){
    const q = p * (CARDS + IN_FLIGHT);
    for (let i = 0; i < CARDS; i++) place(cards[i], i, (q - i) / IN_FLIGHT);
  }

  function render(now){
    frameCards(current);
    deck.rotation.y = current * SPIN + (DRIFT ? now * 0.000015 : 0);
    deck.rotation.z = DRIFT ? Math.sin(now * 0.00013) * 0.028 : 0;
    renderer.render(scene, camera);
  }

  if (STATIC){
    target = current = 0.16;                  // несколько карт на середине падения
    render(0);
    // держим кадр корректным при повороте экрана
    addEventListener('resize', () => render(0), { passive:true });
  } else {
    target = current = scrollProgress();
    const loop = () => {
      const now = performance.now();
      const diff = target - current;
      current += diff * SMOOTH;
      const moving = Math.abs(diff) > 0.0004;
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
