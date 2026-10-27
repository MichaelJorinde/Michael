// € Privé: afgeschermd onderdeel met pincode.
import { financeViews } from './finance.js';

export function privateViews({ app, api, esc, money, num, toast, setChrome }) {
  // Numeriek toetsenbord; roept onDone(pin) aan bij ✓.
  function keypad(el, { title, subtitle = '', onDone }) {
    let pin = '';
    el.innerHTML = `
      <section class="card pin-card">
        <div class="pin-lock" aria-hidden="true">
          <svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg>
        </div>
        <h1>${esc(title)}</h1>
        <p class="muted small pin-sub">${esc(subtitle)}</p>
        <div class="pin-dots" aria-live="polite"></div>
        <p class="error pin-err" role="alert"></p>
        <div class="pin-pad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-k="${n}">${n}</button>`).join('')}
          <button type="button" data-k="del" class="pin-aux" aria-label="Wissen">⌫</button>
          <button type="button" data-k="0">0</button>
          <button type="button" data-k="ok" class="pin-ok" aria-label="Bevestigen">✓</button>
        </div>
      </section>`;
    const dots = el.querySelector('.pin-dots');
    const err = el.querySelector('.pin-err');
    const draw = () => {
      dots.innerHTML = Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<span class="${i < pin.length ? 'on' : ''}"></span>`).join('');
      dots.setAttribute('aria-label', `${pin.length} cijfers ingegeven`);
    };
    let busy = false;
    const submit = async () => {
      if (busy) return;
      if (pin.length < 4) { err.textContent = 'Minstens 4 cijfers'; return; }
      busy = true;
      try {
        await onDone(pin);
      } catch (e) {
        err.textContent = e.message;
        pin = '';
        draw();
        el.querySelector('.pin-dots').classList.add('shake');
        setTimeout(() => el.querySelector('.pin-dots')?.classList.remove('shake'), 400);
      } finally {
        busy = false;
      }
    };
    el.querySelector('.pin-pad').addEventListener('click', (e) => {
      const k = e.target.closest('button')?.dataset.k;
      if (!k) return;
      err.textContent = '';
      if (k === 'del') pin = pin.slice(0, -1);
      else if (k === 'ok') return submit();
      else if (pin.length < 8) pin += k;
      draw();
    });
    // Ook typen met een (hardware)toetsenbord.
    const onKey = (e) => {
      if (!document.body.contains(el.querySelector('.pin-pad'))) { document.removeEventListener('keydown', onKey); return; }
      if (/^\d$/.test(e.key) && pin.length < 8) { pin += e.key; draw(); }
      else if (e.key === 'Backspace') { pin = pin.slice(0, -1); draw(); }
      else if (e.key === 'Enter') submit();
    };
    document.addEventListener('keydown', onKey);
    draw();
  }

  // Nieuwe pincode kiezen en bevestigen (eventueel eerst de huidige).
  function choosePin({ current = null, title, after }) {
    keypad(app, {
      title,
      subtitle: 'Kies 4 tot 8 cijfers.',
      onDone: async (first) => {
        keypad(app, {
          title: 'Bevestig je pincode',
          subtitle: 'Geef dezelfde pincode nog eens in.',
          onDone: async (second) => {
            if (second !== first) throw new Error('De pincodes komen niet overeen');
            await api('private/pin', { method: 'POST', body: { pin: first, current } });
            toast('Pincode ingesteld');
            after();
          },
        });
      },
    });
  }

  async function gate(next) {
    const status = await api('private/status');
    if (!status.hasPin) {
      setChrome('p-overview', 'private');
      choosePin({ title: 'Kies een pincode voor € Privé', after: () => next() });
      return;
    }
    if (!status.unlocked) {
      setChrome('p-overview', 'private');
      keypad(app, {
        title: '€ Privé',
        subtitle: 'Geef je pincode in.',
        onDone: async (pin) => {
          await api('private/unlock', { method: 'POST', body: { pin } });
          next();
        },
      });
      return;
    }
    next();
  }

  const LOCK_BUTTON = '<button id="lock" class="btn-ghost btn-small" type="button">🔒 Vergrendel</button>';
  const overviewContent = () => finance.overview(LOCK_BUTTON);

  async function lockNow() {
    await api('private/lock', { method: 'POST' }).catch(() => {});
    toast('€ Privé vergrendeld');
    if (location.hash === '#/private') overview(); else location.hash = '#/private';
  }

  async function overview() {
    await gate(overviewContent);
  }

  async function changePin() {
    setChrome('p-pin', 'private');
    await gate(() => {
      setChrome('p-pin', 'private');
      keypad(app, {
        title: 'Pincode wijzigen',
        subtitle: 'Geef eerst je huidige pincode in.',
        onDone: async (current) => {
          await api('private/unlock', { method: 'POST', body: { pin: current } }); // controleert de huidige pincode
          choosePin({ current, title: 'Kies een nieuwe pincode', after: () => { location.hash = '#/private'; } });
        },
      });
    });
  }

  const finance = financeViews({ app, api, esc, money, num, toast, setChrome, gate });

  return { overview, changePin, lockNow, importView: () => finance.importView() };
}
