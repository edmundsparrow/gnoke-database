/* ════════════════════════════════════════════════════════════
   scripts/main.js  —  Login module for index.html
   Config: set ENDPOINT and SESSION_KEY below, edit APP_PAGE.
   ════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const SESSION_KEY = 'app_session';
  const APP_PAGE    = 'app';

  let _mode = 'login';

  /* ── CANVAS BACKGROUND ────────────────────────────────────── */
  (function initCanvas() {
    const canvas = document.getElementById('bg');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let W, H, orbs = [];

    function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
    function makeOrb() {
      return { x: Math.random()*W, y: Math.random()*H, r: 180+Math.random()*240,
               dx: (Math.random()-0.5)*0.25, dy: (Math.random()-0.5)*0.25,
               hue: Math.random()<0.6 ? 0 : 220 };
    }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      orbs.forEach(o => {
        const g = ctx.createRadialGradient(o.x,o.y,0,o.x,o.y,o.r);
        g.addColorStop(0, `hsla(${o.hue},80%,60%,0.12)`);
        g.addColorStop(1, `hsla(${o.hue},80%,60%,0)`);
        ctx.beginPath(); ctx.arc(o.x,o.y,o.r,0,Math.PI*2);
        ctx.fillStyle = g; ctx.fill();
        o.x+=o.dx; o.y+=o.dy;
        if (o.x < -o.r) o.x=W+o.r; if (o.x > W+o.r) o.x=-o.r;
        if (o.y < -o.r) o.y=H+o.r; if (o.y > H+o.r) o.y=-o.r;
      });
      requestAnimationFrame(draw);
    }
    window.addEventListener('resize', resize);
    resize(); orbs = Array.from({length:5}, makeOrb); draw();
  })();

  /* ── NOTIFY ───────────────────────────────────────────────── */
  function _notify(id, msg, type) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.className   = 'notify ' + (type || '');
  }
  function _clearNotify(id) {
    const el = document.getElementById(id);
    if (el) { el.textContent = ''; el.className = 'notify'; }
  }
  function _busy(btnId, on, label) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = on;
    btn.textContent = on ? 'Please wait…' : label;
  }

  /* ── MODE TOGGLE ──────────────────────────────────────────── */
  function toggleMode() {
    _mode = _mode === 'login' ? 'register' : 'login';
    const reg = _mode === 'register';

    document.getElementById('mode-title').textContent  = reg ? 'Create Account'      : 'Sign In';
    document.getElementById('mode-sub').textContent    = reg ? 'Register a new account' : 'Access your account';
    document.getElementById('btn-submit').textContent  = reg ? 'Create Account'      : 'Sign In';
    document.getElementById('toggle-text').textContent = reg ? 'Already registered? ' : 'New here? ';
    document.getElementById('toggle-btn').textContent  = reg ? 'Sign In'             : 'Create Account';

    document.getElementById('reg-fields').style.display    = reg ? '' : 'none';
    document.getElementById('login-field').style.display   = reg ? 'none' : '';
    document.getElementById('field-confirm').style.display = reg ? '' : 'none';
    document.getElementById('field-auth').style.display    = reg ? '' : 'none';
    document.getElementById('pin-label').textContent       = reg ? 'Choose a PIN *' : 'PIN *';

    _clearNotify('notify');
  }

  /* ── FORM SUBMIT ──────────────────────────────────────────── */
  function submit(e) {
    e.preventDefault();
    if (_mode === 'login') _login();
    else _register();
  }

  /* ── REGISTER ─────────────────────────────────────────────── */
  async function _register() {
    const name      = document.getElementById('field-name').value.trim();
    const phone     = document.getElementById('field-phone').value.trim();
    const email     = document.getElementById('field-email').value.trim();
    const pin       = document.getElementById('field-pin').value;
    const pinConf   = document.getElementById('field-pin-confirm').value;
    const regSecret = document.getElementById('field-auth-code').value.trim();

    if (!name)            return _notify('notify', 'Enter your full name.',              'err');
    if (!phone && !email) return _notify('notify', 'Enter at least a phone or email.',   'err');
    if (pin.length < 4)   return _notify('notify', 'PIN must be at least 4 characters.','err');
    if (pin !== pinConf)  return _notify('notify', 'PINs do not match.',                 'err');
    if (!regSecret)       return _notify('notify', 'Enter the authorization code.',      'err');

    _busy('btn-submit', true); _clearNotify('notify');

    try {
      const data = await Connect.post('register', { name, phone, email, pin, reg_secret: regSecret });
      _notify('notify', 'Account created! Signing you in…', 'ok');
      _saveSession(data);
    } catch (err) {
      _notify('notify', err.message, 'err');
    } finally {
      _busy('btn-submit', false, 'Create Account');
    }
  }

  /* ── LOGIN ────────────────────────────────────────────────── */
  async function _login() {
    const raw = document.getElementById('field-id').value.trim();
    const pin = document.getElementById('field-pin').value;

    if (!raw) return _notify('notify', 'Enter your phone or email.', 'err');
    if (!pin) return _notify('notify', 'Enter your PIN.',            'err');

    _busy('btn-submit', true); _clearNotify('notify');

    try {
      const isEmail = raw.includes('@');
      const data = await Connect.post('sign-in', { pin, ...(isEmail ? { email: raw } : { phone: raw }) });
      _saveSession(data);
    } catch (err) {
      _notify('notify', err.message, 'err');
    } finally {
      _busy('btn-submit', false, 'Sign In');
    }
  }

  /* ── SAVE SESSION & REDIRECT ──────────────────────────────── */
  function _saveSession(data) {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      token        : data.token,
      user_id      : data.user_id,
      workspace_id : data.workspace_id || '',
      name         : data.name  || data.profile?.name  || '',
      role         : data.role  || data.profile?.role  || '',
      phone        : data.phone || data.profile?.phone || '',
      email        : data.email || data.profile?.email || '',
    }));
    window.location.href = APP_PAGE;
  }

  /* ── OTP RESTORE MODAL ────────────────────────────────────── */
  function openRestore() {
    document.getElementById('otp-modal').classList.add('open');
    _clearNotify('restore-notify');
    document.getElementById('restore-id').focus();
  }
  function closeRestore() {
    document.getElementById('otp-modal').classList.remove('open');
  }
  document.getElementById('otp-modal').addEventListener('click', function (e) {
    if (e.target === this) closeRestore();
  });

  async function redeemOtp() {
    const raw = document.getElementById('restore-id').value.trim();
    const otp = document.getElementById('restore-code').value.trim().toUpperCase();
    const pin = document.getElementById('restore-pin').value;

    if (!raw)           return _notify('restore-notify', 'Enter your phone or email.',            'err');
    if (!otp)           return _notify('restore-notify', 'Enter the OTP code.',                   'err');
    if (pin.length < 4) return _notify('restore-notify', 'New PIN must be at least 4 characters.','err');

    _busy('restore-submit', true); _clearNotify('restore-notify');

    try {
      const isEmail = raw.includes('@');
      const data = await Connect.post('redeem-otp', { otp, pin, ...(isEmail ? { email: raw } : { phone: raw }) });
      _notify('restore-notify', 'Access restored! Signing you in…', 'ok');
      await new Promise(r => setTimeout(r, 700));
      _saveSession(data);
    } catch (err) {
      _notify('restore-notify', err.message, 'err');
    } finally {
      _busy('restore-submit', false, 'Restore Access');
    }
  }

  /* ── BOOT ─────────────────────────────────────────────────── */
  (function _boot() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY));
      if (s?.token && s?.user_id) window.location.href = APP_PAGE;
    } catch (_) {}
  })();

  /* ── PUBLIC API ───────────────────────────────────────────── */
  window.Auth = { submit, toggleMode, openRestore, closeRestore, redeemOtp };

})();
