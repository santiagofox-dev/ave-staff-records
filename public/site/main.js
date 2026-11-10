/* Grupo AVE — gpoave.com interactions. Plain JS, no dependencies, CSP-safe (no inline styles in markup). */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- Language (Spanish is the markup; English lives here) ---------------- */
  const EN = {
    'nav.process': 'How we work', 'nav.tech': 'Technology', 'nav.services': 'Services', 'nav.coverage': 'Coverage', 'nav.portal': 'Portal', 'nav.cta': "Let's talk",
    'hero.eyebrow': 'Industrial cafeterias · Northern Mexico',
    'hero.t1': 'Fuel for', 'hero.t2': 'every shift.',
    'hero.sub': "We run industrial cafeterias for Mexico's most demanding plants. Nutritionist-designed menus, certified food safety and an operation you can see in real time.",
    'hero.cta1': 'Request a proposal', 'hero.cta2': 'See how we work', 'hero.stat': 'meals a day',
    'logos.title': 'Plants that trust Grupo AVE',
    'man.kicker': '01 — Our idea',
    'man.text': "A cafeteria isn't an operating expense. It's the energy, health and morale of every person on your production line. That's why we design it the way a plant is designed: with engineering, data and zero improvisation.",
    'metric.lbl': 'meals served every day', 'metric.sub': 'in manufacturing plants across Chihuahua, Coahuila, Jalisco and Baja California, every shift, every day.',
    'proc.kicker': '02 — How we work', 'proc.title1': 'Cook & Chill.', 'proc.title2': 'Safety at scale.',
    'proc.s1t': 'Precision cooking', 'proc.s1d': 'Intelligent ovens hold exact humidity, flavor and core temperature for every dish.',
    'proc.s2t': 'Blast chilling', 'proc.s2d': 'Immediate cooling halts bacterial growth and ensures maximum food safety.',
    'proc.s3t': 'Regeneration', 'proc.s3d': 'Precise reheating restores the exact temperature and texture right at the moment of service.',
    'bento.kicker': '03 — What we do', 'bento.title': 'Food planned like a production line.',
    'bento.a.tag': 'Nutrition', 'bento.a.t': 'Nutritionist-designed menus', 'bento.a.d': 'Balanced to sustain full shifts. Vegetarian, vegan and diabetic-friendly options every day.',
    'bento.b.tag': 'Smart kitchen', 'bento.b.t': 'Connected UNOX ovens', 'bento.b.d': 'One oven replaces up to four gas units and cuts energy use.',
    'bento.c.tag': 'Spaces', 'bento.c.t': 'Dining halls people want to go to', 'bento.c.d': 'We turn the cafeteria from a service into a real employee benefit.',
    'tech.kicker': '04 — Technology', 'tech.title': 'Full transparency, in real time.',
    'tech.lead': 'Every critical task is logged with photo evidence. Your team can review the cafeteria operation anytime, from any device.',
    'tech.c1': 'Digital hygiene and FIFO inventory', 'tech.c2': 'Mandatory photo evidence on critical tasks', 'tech.c3': 'Direct access for the client',
    'tech.dashTitle': 'Operations dashboard · example', 'tech.shift': 'Current shift', 'tech.status': 'Operation on track',
    'tech.r1': 'Hot line temperature logged', 'tech.r2': 'Area cleaning photo uploaded', 'tech.r3': 'FIFO inventory verified', 'tech.r4': "Today's menu published",
    'svc.kicker': '05 — Services', 'svc.title': 'More than a cafeteria.',
    'svc.1t': 'Industrial cafeteria', 'svc.1d': 'Breakfast, lunch and dinner tuned to every shift, with a daily healthy line.',
    'svc.2t': 'Available 24/7', 'svc.2d': 'Coffee shop and snack bar, traditional vending, artisanal pizza and ready-to-heat complete meals.',
    'svc.3t': 'Corporate events', 'svc.3d': 'Box lunches, coffee breaks, plated service, buffets, food trucks and cocktails for your plant.',
    'svc.4t': 'Order & Pick Up app', 'svc.4d': 'Digital ordering, custom bowls and an interactive weekly menu for all staff.',
    'certs.lbl': 'Certified to operate in the most demanding plants', 'certs.rc': 'USD 1M liability insurance',
    'ba.kicker': '06 — Transformation', 'ba.title': 'From a cafeteria people tolerate to one they enjoy.', 'ba.before': 'Before', 'ba.after': 'Grupo AVE standard',
    'cov.kicker': '07 — Coverage', 'cov.title': 'Where industry is.',
    'ct.kicker': '08 — Contact', 'ct.title': "Let's talk about your plant.", 'ct.lead': 'We visit your plant, understand your shifts and bring you a proposal built around them.', 'ct.wa': 'WhatsApp',
    'f.name': 'Name', 'f.company': 'Company / plant', 'f.city': 'City', 'f.count': 'Daily diners (approx.)', 'f.msg': 'What do you need?', 'f.submit': 'Send request',
    'f.note': 'Your email app will open with the message ready for santiago.fox@gpoave.com',
    'foot.privacy': 'Privacy notice', 'foot.rights': 'All rights reserved.', 'foot.map': 'Map',
  };
  const ES = {};
  $$('[data-i18n]').forEach(el => { ES[el.dataset.i18n] = el.textContent; });
  let lang = 'es';
  try { const s = localStorage.getItem('ave_lang'); if (s === 'en' || s === 'es') lang = s; } catch (e) {}

  function setLang(l) {
    lang = l;
    try { localStorage.setItem('ave_lang', l); } catch (e) {}
    document.documentElement.lang = l;
    const dict = l === 'en' ? EN : ES;
    $$('[data-i18n]').forEach(el => { const v = dict[el.dataset.i18n]; if (v != null) el.textContent = v; });
    $$('#lang span').forEach(s => s.classList.toggle('on', s.dataset.l === l));
    splitManifesto(); onScroll();
  }
  $('#lang').addEventListener('click', () => setLang(lang === 'es' ? 'en' : 'es'));

  /* ---------------- Nav ---------------- */
  const nav = $('#nav'), burger = $('#burger'), links = $('#links');
  burger.addEventListener('click', () => {
    const open = burger.getAttribute('aria-expanded') !== 'true';
    burger.setAttribute('aria-expanded', String(open)); links.classList.toggle('open', open); nav.classList.toggle('solid', open || scrollY > 24);
  });
  $$('a', links).forEach(a => a.addEventListener('click', () => { burger.setAttribute('aria-expanded', 'false'); links.classList.remove('open'); }));

  /* ---------------- Heat field (WebGL) ---------------- */
  const FRAG = `precision highp float;
uniform vec2 R; uniform float T; uniform vec2 M; uniform float I; uniform float L;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1.,0.)),u.x),mix(h(i+vec2(0.,1.)),h(i+vec2(1.,1.)),u.x),u.y);}
float fbm(vec2 p){float v=0.,a=.5;mat2 r=mat2(.8,.6,-.6,.8);for(int i=0;i<5;i++){v+=a*n(p);p=r*p*2.02;a*=.5;}return v;}
void main(){
  vec2 uv=gl_FragCoord.xy/R; vec2 p=(gl_FragCoord.xy-.5*R)/R.y;
  p+=(M-.5)*.12; float t=T*.055;
  vec2 q=vec2(fbm(p*1.3+vec2(0.,t)),fbm(p*1.3+vec2(5.2,1.3)-t));
  vec2 w=vec2(fbm(p*1.3+2.9*q+vec2(1.7,9.2)+t*1.3),fbm(p*1.3+2.9*q+vec2(8.3,2.8)-t*1.1));
  float f=fbm(p*1.5+3.3*w);
  vec3 ink=vec3(.043,.047,.055),deep=vec3(.32,.055,.02),brand=vec3(1.,.24,.08),ember=vec3(1.,.54,.3),cream=vec3(1.,.87,.76);
  float k=smoothstep(.22,.92,f);
  vec3 c=mix(ink,deep,smoothstep(.0,.42,k));
  c=mix(c,brand,smoothstep(.42,.74,k));
  c=mix(c,ember,smoothstep(.74,.9,k));
  c=mix(c,cream,smoothstep(.9,1.,k)*.55);
  float d=abs(fract(f*11.)-.5);
  c+=smoothstep(.455,.5,d)*L*(.25+k)*vec3(1.,.62,.45);
  float mask=mix(.12,1.,smoothstep(.05,.95,uv.x))*mix(.35,1.,smoothstep(.0,.45,uv.y));
  c=mix(ink,c,clamp(mask*I,0.,1.));
  c+=(h(gl_FragCoord.xy+fract(T))-.5)*.03;
  gl_FragColor=vec4(c,1.);
}`;
  function heat(canvas, opts) {
    if (!canvas) return;
    let gl;
    try { gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' }); } catch (e) {}
    if (!gl) return; // CSS gradient stays as the fallback
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return;
    gl.useProgram(pr);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = k => gl.getUniformLocation(pr, k);
    const uR = U('R'), uT = U('T'), uM = U('M'), uI = U('I'), uL = U('L');
    gl.uniform1f(uI, opts.intensity); gl.uniform1f(uL, opts.lines);
    const scale = opts.scale || 0.5;
    let w = 0, h = 0, visible = true, raf = 0, mx = 0.5, my = 0.5, tx = 0.5, ty = 0.5;
    const t0 = performance.now() - 40000 * Math.random();
    function size() {
      const r = canvas.getBoundingClientRect();
      w = Math.max(2, Math.round(r.width * scale)); h = Math.max(2, Math.round(r.height * scale));
      canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); gl.uniform2f(uR, w, h);
    }
    function frame(now) {
      mx += (tx - mx) * 0.04; my += (ty - my) * 0.04;
      gl.uniform1f(uT, (now - t0) / 1000); gl.uniform2f(uM, mx, my);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (!reduce && visible && !document.hidden) raf = requestAnimationFrame(frame); else raf = 0;
    }
    const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
    size(); frame(performance.now());
    addEventListener('resize', () => { size(); if (reduce) frame(performance.now()); }, { passive: true });
    if ('IntersectionObserver' in window) new IntersectionObserver(e => { visible = e[0].isIntersecting; if (visible && !reduce) kick(); }).observe(canvas);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !reduce) kick(); });
    if (opts.mouse) addEventListener('pointermove', e => { tx = e.clientX / innerWidth; ty = 1 - e.clientY / innerHeight; }, { passive: true });
    if (!reduce) kick();
  }
  heat($('#heat'), { intensity: 1, lines: 1, mouse: true, scale: 0.5 });
  heat($('#heat2'), { intensity: 0.8, lines: 0.6, scale: 0.4 });

  /* ---------------- Logo marquee: second copy for the seamless loop ---------------- */
  // (duplicated in markup; nothing to do here)

  /* ---------------- Manifesto: words light up as you read ---------------- */
  const man = $('#manifesto');
  const HOT = /^(energía|salud|ánimo|ingeniería|energy|health|morale|engineering)[,.:]?$/i;
  let words = [];
  function splitManifesto() {
    const txt = man.textContent.trim();
    man.textContent = '';
    words = txt.split(/\s+/).map((wd, i, a) => {
      const s = document.createElement('span'); s.className = 'w'; s.textContent = wd + (i < a.length - 1 ? ' ' : '');
      if (HOT.test(wd)) s.dataset.hot = '1';
      man.appendChild(s); return s;
    });
    if (reduce) words.forEach(s => s.classList.add('lit', ...(s.dataset.hot ? ['hot'] : [])));
  }

  /* ---------------- Process: pinned Cook & Chill ---------------- */
  const track = $('#process-track'), steps = $$('.step'), dial = $('#dial'), prog = $('#dial-prog'), icons = $$('.dial-icon'), lbl = $('#dial-lbl'), ticksG = $('#ticks');
  const NT = 60, ticks = [];
  for (let i = 0; i < NT; i++) {
    const a = (i / NT) * Math.PI * 2 - Math.PI / 2, r1 = 182, r2 = i % 5 ? 188 : 194;
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l.setAttribute('x1', 200 + r1 * Math.cos(a)); l.setAttribute('y1', 200 + r1 * Math.sin(a));
    l.setAttribute('x2', 200 + r2 * Math.cos(a)); l.setAttribute('y2', 200 + r2 * Math.sin(a));
    ticksG.appendChild(l); ticks.push(l);
  }
  const LABELS = ['COOK', 'CHILL', 'REGEN'];
  let curStep = -1;
  function setStep(i, p) {
    if (i !== curStep) {
      curStep = i;
      steps.forEach((s, k) => s.classList.toggle('is-on', k === i));
      icons.forEach((g, k) => g.classList.toggle('is-on', k === i));
      dial.classList.toggle('cold', i === 1);
      lbl.textContent = LABELS[i];
    }
    prog.style.strokeDashoffset = String(100 - Math.max(2, p * 100));
    const on = Math.round(p * NT);
    ticks.forEach((t, k) => t.classList.toggle('on', k < on));
  }
  const pinned = () => innerWidth > 860;
  let autoStep = null;
  function processScroll() {
    if (!pinned()) return;
    const r = track.getBoundingClientRect();
    const total = r.height - innerHeight;
    const p = Math.min(1, Math.max(0, -r.top / total));
    setStep(Math.min(2, Math.floor(p * 3)), p);
  }
  function mobileProcess() {
    if (pinned() || autoStep || reduce) return;
    let i = 0, t = 0;
    autoStep = setInterval(() => { if (pinned()) { clearInterval(autoStep); autoStep = null; return; } t = (t + 1) % 30; i = Math.floor(t / 10); setStep(i, (t + 1) / 30); }, 300);
  }
  setStep(0, 0.02);

  /* ---------------- Metric count-up ---------------- */
  const mv = $('#metric-val');
  let counted = false;
  function countUp() {
    if (counted || reduce) return; counted = true;
    const t0 = performance.now(), D = 1800;
    (function f(now) { const k = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - k, 4); mv.textContent = Math.round(12000 * e).toLocaleString('en-US'); if (k < 1) requestAnimationFrame(f); })(t0);
  }

  /* ---------------- Reveal (only for what starts below the fold) ---------------- */
  const revealEls = $$('.kicker, .h2, .lead, .tile, .svc, .certs, .ba, .cities, .cov-map, .tech-visual, .form, .person, .checks, .metric-copy');
  if ('IntersectionObserver' in window && !reduce) {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
    revealEls.forEach((el, i) => {
      if (el.getBoundingClientRect().top > innerHeight * 0.92) { el.classList.add('rv'); el.style.transitionDelay = (i % 4) * 70 + 'ms'; io.observe(el); }
    });
    new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) countUp(); }), { threshold: 0.4 }).observe($('#metric'));
    new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) mobileProcess(); })).observe(track);
  }

  /* ---------------- Dashboard: live bars, new log rows, tilt ---------------- */
  const bars = $('#bars');
  const NB = 28, barEls = [];
  for (let i = 0; i < NB; i++) { const b = document.createElement('i'); bars.appendChild(b); barEls.push(b); }
  const level = i => 35 + 40 * Math.sin(i / 4) + 18 * Math.random();
  function updBars(shift) { barEls.forEach((b, i) => { b.style.height = Math.max(8, Math.min(100, level(i + shift))) + '%'; }); }
  let shift = 0; updBars(0);
  const ROWS = [
    ['Muestra de platillo registrada', 'Dish sample logged'], ['Temperatura de cámara fría verificada', 'Walk-in cooler temperature checked'],
    ['Foto de línea de servicio cargada', 'Service line photo uploaded'], ['Abatidor: ciclo completado', 'Blast chiller: cycle complete'],
    ['Encuesta de satisfacción recibida', 'Satisfaction survey received'], ['Limpieza de comedor confirmada', 'Dining hall cleaning confirmed'],
  ];
  const list = $('#dash-list');
  let rowI = 0, clock = 7 * 60 + 18;
  function addRow() {
    clock += 4 + Math.floor(Math.random() * 9);
    const li = document.createElement('li'); li.className = 'new';
    const ok = document.createElement('span'); ok.className = 'ok';
    const tx = document.createElement('span'); tx.textContent = ROWS[rowI % ROWS.length][lang === 'en' ? 1 : 0];
    const tm = document.createElement('span'); tm.className = 'mono dim t'; tm.textContent = String(Math.floor(clock / 60) % 24).padStart(2, '0') + ':' + String(clock % 60).padStart(2, '0');
    li.append(ok, tx, tm); list.prepend(li); rowI++;
    while (list.children.length > 4) list.lastElementChild.remove();
  }
  let dashTimer = null;
  const tilt = $('#tilt'), dash = $('.dash', tilt);
  if ('IntersectionObserver' in window && !reduce) {
    new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting && !dashTimer) dashTimer = setInterval(() => { shift += 1; updBars(shift); if (shift % 2 === 0) addRow(); }, 1600);
      else if (!e.isIntersecting && dashTimer) { clearInterval(dashTimer); dashTimer = null; }
    })).observe(tilt);
  }
  if (!reduce && matchMedia('(pointer: fine)').matches) {
    tilt.addEventListener('pointermove', e => {
      const r = tilt.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      dash.style.transform = `rotateY(${-14 + x * 12}deg) rotateX(${8 - y * 10}deg)`;
    });
    tilt.addEventListener('pointerleave', () => { dash.style.transform = ''; });
  }

  /* ---------------- Before / after ---------------- */
  const baR = $('#ba-range'), baB = $('#ba-before'), baH = $('#ba-handle');
  baR.addEventListener('input', () => { const v = +baR.value; baB.style.clipPath = `inset(0 ${100 - v}% 0 0)`; baH.style.left = v + '%'; });

  /* ---------------- Map pins + city highlight ---------------- */
  const map = $('#map'), pins = $('#pins'), NS = 'http://www.w3.org/2000/svg';
  const statePaths = $$('.st.on', map);
  statePaths.forEach(p => {
    const b = p.getBBox(), cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    const g = document.createElementNS(NS, 'g');
    const ring = document.createElementNS(NS, 'circle'); ring.setAttribute('cx', cx); ring.setAttribute('cy', cy); ring.setAttribute('r', 6); ring.setAttribute('class', 'pin-ring');
    const core = document.createElementNS(NS, 'circle'); core.setAttribute('cx', cx); core.setAttribute('cy', cy); core.setAttribute('r', 4); core.setAttribute('class', 'pin-core');
    g.append(ring, core); pins.appendChild(g);
  });
  const cities = $$('#cities li');
  function hl(id, on) {
    statePaths.forEach(p => p.classList.toggle('hl', on && p.dataset.state === id));
    cities.forEach(c => c.classList.toggle('hl', on && c.dataset.state === id));
  }
  cities.forEach(c => { c.addEventListener('mouseenter', () => hl(c.dataset.state, true)); c.addEventListener('mouseleave', () => hl(c.dataset.state, false)); });
  statePaths.forEach(p => { p.addEventListener('mouseenter', () => hl(p.dataset.state, true)); p.addEventListener('mouseleave', () => hl(p.dataset.state, false)); });

  /* ---------------- Contact form → email ---------------- */
  $('#form').addEventListener('submit', e => {
    e.preventDefault();
    const v = id => $('#' + id).value.trim();
    const err = $('#f-err');
    if (!v('f-name') || !v('f-company') || !v('f-city')) {
      err.textContent = lang === 'en' ? 'Please add your name, company and city so we can reach you.' : 'Escriba su nombre, empresa y ciudad para poder contactarle.';
      err.hidden = false; return;
    }
    err.hidden = true;
    const subject = `Solicitud de propuesta – ${v('f-company')}`;
    const body = `Hola Santiago,\n\nMe gustaría recibir una propuesta de comedor industrial.\n\nNombre: ${v('f-name')}\nEmpresa / planta: ${v('f-company')}\nCiudad: ${v('f-city')}\nComensales al día (aprox.): ${v('f-count') || '—'}\n\n${v('f-msg')}\n`;
    location.href = `mailto:santiago.fox@gpoave.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  });

  /* ---------------- Scroll loop ---------------- */
  let ticking = false;
  function onScroll() {
    nav.classList.toggle('solid', scrollY > 24 || links.classList.contains('open'));
    processScroll();
    if (words.length && !reduce) {
      const r = man.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (innerHeight * 0.85 - r.top) / (r.height + innerHeight * 0.35)));
      const lit = Math.round(p * words.length);
      words.forEach((s, i) => { const on = i < lit; s.classList.toggle('lit', on); s.classList.toggle('hot', on && !!s.dataset.hot); });
    }
    ticking = false;
  }
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  addEventListener('resize', onScroll, { passive: true });

  $('#year').textContent = new Date().getFullYear();
  setLang(lang);
})();
