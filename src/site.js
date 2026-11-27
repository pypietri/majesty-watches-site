// Majesty Watches — interactions légères (aucune dépendance)
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // En-tête : bordure au scroll, masqué en descendant
  const hd = $('[data-hd]');
  const wa = $('.wa-float');
  let lastY = scrollY;
  const onScroll = () => {
    const y = scrollY;
    hd.classList.toggle('is-scrolled', y > 8);
    if (!hd.classList.contains('is-open')) hd.classList.toggle('is-hidden', y > 300 && y > lastY + 4 ? true : y < lastY - 4 ? false : hd.classList.contains('is-hidden'));
    if (wa) wa.classList.toggle('is-in', y > 400);
    lastY = y;
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Menu mobile
  const burger = $('[data-burger]');
  burger?.addEventListener('click', () => {
    const open = !hd.classList.contains('is-open');
    hd.classList.toggle('is-open', open);
    hd.classList.remove('is-hidden');
    burger.setAttribute('aria-expanded', open);
  });

  // Apparitions au défilement
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }) : null;
  $$('[data-reveal], [data-hero]').forEach((el, i) => {
    if (!io) return el.classList.add('is-in');
    el.style.transitionDelay = el.closest('.grid, .trust-grid, .reviews-grid') ? `${(i % 4) * 70}ms` : '';
    io.observe(el);
  });

  // Anneau 3D « Nouvel arrivage » : tourne seulement au geste (trackpad, glisser, flèches, clavier)
  const ring = $('[data-ring]');
  if (ring) {
    const track = $('[data-ring-track]', ring), stage = $('[data-ring-stage]', ring);
    const items = $$('.ring-it', ring), n = items.length, step = 360 / n;
    const nameEl = $('[data-ring-name]', ring), priceEl = $('[data-ring-price]', ring), linkEl = $('[data-ring-link]', ring);
    let tgt = 0, cur = 0, raf = null, front = 0, snapT = null;
    const render = () => {
      cur += (tgt - cur) * 0.12;
      if (Math.abs(tgt - cur) < 0.02) cur = tgt;
      track.style.setProperty('--a', cur.toFixed(3) + 'deg');
      let best = 0, bestD = 999;
      items.forEach((it, i) => {
        const d = ((i * step + cur) % 360 + 540) % 360 - 180, ad = Math.abs(d);
        it.style.opacity = (1 - Math.min(ad, 110) / 140).toFixed(3);
        it.style.filter = ad > 25 ? `blur(${((ad - 25) / 30).toFixed(2)}px)` : 'none';
        if (ad < bestD) { bestD = ad; best = i; }
      });
      if (best !== front) { front = best; nameEl.textContent = items[best].dataset.name; priceEl.textContent = items[best].dataset.price; linkEl.href = items[best].getAttribute('href'); }
      raf = cur !== tgt ? requestAnimationFrame(render) : null;
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(render); };
    const snap = () => { tgt = Math.round(tgt / step) * step; kick(); };
    const go = dir => { tgt = Math.round(tgt / step) * step - dir * step; kick(); };
    $('[data-ring-prev]', ring).addEventListener('click', () => go(-1));
    $('[data-ring-next]', ring).addEventListener('click', () => go(1));
    stage.tabIndex = 0;
    stage.addEventListener('keydown', e => { if (e.key === 'ArrowRight') { e.preventDefault(); go(1); } if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); } });
    // Trackpad : balayage horizontal à deux doigts (le défilement vertical de la page reste libre)
    stage.addEventListener('wheel', e => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      tgt -= e.deltaX * 0.12; kick();
      clearTimeout(snapT); snapT = setTimeout(snap, 160);
    }, { passive: false });
    // Glisser (souris ou doigt)
    let startX = null, base = 0, moved = false;
    stage.addEventListener('pointerdown', e => { if (e.button) return; startX = e.clientX; base = tgt; moved = false; });
    addEventListener('pointermove', e => {
      if (startX === null) return;
      const dx = e.clientX - startX;
      if (!moved && Math.abs(dx) > 6) { moved = true; stage.classList.add('is-drag'); }
      if (moved) { tgt = base + dx * 0.25; kick(); }
    });
    const end = () => { if (startX === null) return; startX = null; stage.classList.remove('is-drag'); if (moved) snap(); };
    addEventListener('pointerup', end); addEventListener('pointercancel', end);
    // Clic : sur la montre de face → fiche ; sur une autre → elle vient se placer de face
    items.forEach((it, i) => it.addEventListener('click', e => {
      if (moved) { e.preventDefault(); moved = false; return; }
      if (i !== front) {
        e.preventDefault();
        const d = ((i * step + tgt) % 360 + 540) % 360 - 180;
        tgt = Math.round((tgt - d) / step) * step; kick();
      }
    }));
    render();
  }

  // Montres qui défilent (section Vendre)
  const spin = $('[data-spin]');
  if (spin) {
    const imgs = $$('img', spin); let k = 0;
    if (imgs.length > 1) setInterval(() => { imgs[k].classList.remove('on'); k = (k + 1) % imgs.length; imgs[k].classList.add('on'); }, 1500);
  }

  // Avis : carrousel automatique
  const rv = $('[data-rv]');
  if (rv) {
    const items = $$('.rv', rv); const dots = $$('.rv-dots button'); let r = 0, timer;
    const show = i => { r = i; items.forEach((x, j) => x.classList.toggle('on', j === i)); dots.forEach((d, j) => d.setAttribute('aria-current', j === i)); };
    const auto = () => { clearInterval(timer); if (items.length > 1) timer = setInterval(() => show((r + 1) % items.length), 7000); };
    dots.forEach((d, i) => d.addEventListener('click', () => { show(i); auto(); }));
    auto();
  }

  // Vidéo de fond chargée seulement quand elle approche de l’écran
  $$('[data-lazy-video]').forEach(v => {
    const load = () => { $$('source', v).forEach(s => s.src = s.dataset.src); v.load(); v.play().catch(() => {}); };
    if (!('IntersectionObserver' in window)) return load();
    const o = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { load(); o.disconnect(); } }, { rootMargin: '400px' });
    o.observe(v);
  });

  // Collection : filtres, recherche, tri
  const grid = $('[data-grid]');
  if (grid) {
    const cards = $$('.card', grid);
    const chips = $$('.chip');
    const search = $('[data-search]');
    const sort = $('[data-sort]');
    const count = $('[data-count]');
    const empty = $('[data-empty]');
    const params = new URLSearchParams(location.search);
    let marque = params.get('marque') || '';
    if (params.get('q')) search.value = params.get('q');
    const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const apply = () => {
      const q = norm(search.value.trim());
      let n = 0;
      cards.forEach(c => {
        const ok = (!marque || c.dataset.marque === marque) && (!q || norm(c.dataset.q + ' ' + c.dataset.marque.toLowerCase()).includes(q));
        c.classList.toggle('is-out', !ok);
        if (ok) { n++; c.classList.add('is-in'); }
      });
      chips.forEach(ch => ch.setAttribute('aria-pressed', ch.dataset.marque === marque));
      count.textContent = `${n} montre${n > 1 ? 's' : ''}`;
      empty.hidden = n > 0;
      const p = new URLSearchParams();
      if (marque) p.set('marque', marque);
      if (search.value.trim()) p.set('q', search.value.trim());
      history.replaceState(null, '', location.pathname + (p.toString() ? '?' + p : ''));
    };
    const doSort = () => {
      const v = sort.value;
      const sorted = [...cards].sort((a, b) => {
        if (v === 'date') return b.dataset.date.localeCompare(a.dataset.date);
        const pa = +a.dataset.prix || (v === 'asc' ? 1e12 : -1), pb = +b.dataset.prix || (v === 'asc' ? 1e12 : -1);
        return v === 'asc' ? pa - pb : pb - pa;
      });
      sorted.forEach(c => grid.appendChild(c));
    };
    chips.forEach(ch => ch.addEventListener('click', () => { marque = ch.dataset.marque; apply(); }));
    search.addEventListener('input', apply);
    sort.addEventListener('change', doSort);
    apply();
  }

  // Galerie de la fiche montre
  const gal = $('[data-gal]');
  if (gal) {
    const track = $('[data-gal-track]', gal);
    const thumbs = $$('.gal-th', gal);
    const go = i => track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' });
    thumbs.forEach(t => t.addEventListener('click', () => go(+t.dataset.go)));
    track.addEventListener('scroll', () => {
      const i = Math.round(track.scrollLeft / track.clientWidth);
      thumbs.forEach((t, k) => t.setAttribute('aria-current', k === i));
    }, { passive: true });
    addEventListener('keydown', e => {
      if (lb && !lb.hidden) return;
      const i = Math.round(track.scrollLeft / track.clientWidth);
      if (e.key === 'ArrowRight') go(Math.min(i + 1, thumbs.length - 1));
      if (e.key === 'ArrowLeft') go(Math.max(i - 1, 0));
    });
    const lb = $('[data-lb]');
    const lbImg = $('img', lb);
    $$('[data-zoom]', track).forEach(b => b.addEventListener('click', () => {
      lbImg.src = b.dataset.zoom; lbImg.alt = $('img', b)?.alt || '';
      lb.hidden = false; document.body.style.overflow = 'hidden';
    }));
    const close = () => { lb.hidden = true; document.body.style.overflow = ''; };
    lb.addEventListener('click', close);
    addEventListener('keydown', e => { if (e.key === 'Escape' && !lb.hidden) close(); });
  }

  // Formulaire de contact (FormSubmit, envoi sans rechargement)
  const form = $('[data-form]');
  if (form) {
    const msg = $('[data-form-msg]', form);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = $('button[type=submit]', form);
      btn.disabled = true; msg.textContent = 'Envoi en cours…';
      try {
        const data = Object.fromEntries(new FormData(form));
        const res = await fetch(form.action, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(data) });
        const json = await res.json().catch(() => ({}));
        if (res.ok && String(json.success) === 'true') { form.reset(); msg.textContent = 'Merci, votre message a bien été envoyé. Nous vous répondons très vite.'; }
        else throw new Error();
      } catch { msg.textContent = 'L’envoi a échoué. Écrivez-nous directement sur WhatsApp ou par e-mail.'; }
      btn.disabled = false;
    });
  }
})();
