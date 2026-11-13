// Player accounts: the header button and the account dialog, talking to the server's /api.
// The session lives in an HttpOnly cookie that this code never sees; it only asks /api/me.
//
// Emailed links open the app with #verify=TOKEN or #reset=TOKEN. The token sits in the URL's
// fragment, which is never sent to servers; it's read once and removed from the address bar.

import { api } from './api.js';
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);
const VIEWS = ['guest', 'forgot', 'reset', 'message', 'member'];

// onChange(user) runs whenever the signed-in player changes (null when signed out).
export function initAccount({ onChange } = {}) {
  const dialog = $('account-dialog');
  const button = $('account-btn');
  const form = $('account-form');
  const identifier = $('account-identifier');
  const password = $('account-password');
  const error = $('account-error');
  let mode = 'login';
  let user = null;
  let initial = true; // the first answer from /api/me always counts as a change
  let resetToken = null;

  const nameOf = (u) => u.username || u.email;

  function view(name) {
    for (const v of VIEWS) $(`account-${v}`).hidden = v !== name;
  }

  function open(name) {
    view(name);
    if (!dialog.open) dialog.showModal();
  }

  function message(title, text) {
    $('account-message-title').textContent = title;
    $('account-message-text').textContent = text;
    open('message');
  }

  function showUser(next) {
    const changed = (next?.id ?? null) !== (user?.id ?? null);
    user = next;
    button.textContent = user ? nameOf(user) : t('start.sign');
    button.classList.toggle('signed-in', Boolean(user));
    button.title = user ? t('account.account') : t('account.signCreateAccount');
    if (user) {
      $('account-name').textContent = nameOf(user);
      showEmailStatus();
    }
    $('admin-link').hidden = !user?.admin;
    // Tells password managers which account the password forms belong to.
    for (const field of document.querySelectorAll('.account-username')) field.value = user ? nameOf(user) : '';
    if (changed || initial) onChange?.(user);
    initial = false;
  }

  // Whether password recovery is set up, and what's waiting to be confirmed.
  function showEmailStatus() {
    const status = $('email-status');
    const waiting = user.pending_email || (user.email && !user.email_verified ? user.email : null);
    status.classList.toggle('warn', !user.email_verified);
    if (waiting) {
      status.textContent = t('account.checkLinkConfirmUntil2', { a: waiting });
    } else if (user.email) {
      status.textContent = t('account.emailConfirmedResetPassword', { a: user.email });
    } else {
      status.textContent = t('account.addEmailResetPassword');
    }
    $('resend-btn').hidden = !waiting;
    $('email-summary').textContent = user.email ? t('account.changeEmail') : t('account.addEmailPasswordRecovery');
  }

  function setMode(next) {
    mode = next;
    $('tab-login').setAttribute('aria-selected', String(mode === 'login'));
    $('tab-signup').setAttribute('aria-selected', String(mode === 'signup'));
    $('account-submit').textContent = mode === 'login' ? t('start.sign') : t('account.createAccount');
    password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    $('account-hint').hidden = mode === 'login';
    $('forgot-btn').hidden = mode !== 'login';
    error.hidden = true;
  }

  function showError(el, text) {
    el.textContent = text;
    el.hidden = !text;
  }

  // Disables a form's button while a request runs, and shows any error message.
  async function submit(formEl, errorEl, request) {
    const submitBtn = formEl.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    showError(errorEl, '');
    try {
      await request();
    } catch (err) {
      showError(errorEl, err.message);
    } finally {
      submitBtn.disabled = false;
    }
  }

  /* ---------- Sign in / create account ---------- */

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(form, error, async () => {
      const signingUp = mode === 'signup';
      const { user: next } = await api(mode, { identifier: identifier.value, password: password.value });
      password.value = '';
      showUser(next);
      if (signingUp && next.email) {
        message(t('account.welcome2'), t('account.weSentLinkConfirm', { a: next.email }));
      } else {
        dialog.close();
      }
    });
  });

  /* ---------- Forgot password ---------- */

  $('forgot-btn').addEventListener('click', () => {
    $('forgot-email').value = identifier.value.includes('@') ? identifier.value : '';
    showError($('forgot-error'), '');
    $('forgot-done').hidden = true;
    view('forgot');
    $('forgot-email').focus();
  });
  $('forgot-back').addEventListener('click', () => view('guest'));
  $('forgot-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submit(e.currentTarget, $('forgot-error'), async () => {
      await api('reset/request', { email: $('forgot-email').value });
      // The same answer whether or not the account exists.
      $('forgot-done').textContent = t('account.emailBelongsAccountConfirmed');
      $('forgot-done').hidden = false;
    });
  });

  $('reset-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submit(e.currentTarget, $('reset-error'), async () => {
      const { user: next } = await api('reset/confirm', { token: resetToken, password: $('reset-password').value });
      resetToken = null;
      e.target.reset();
      showUser(next);
      message(t('account.passwordChanged'), t('account.signedNewPasswordEvery'));
    });
  });

  /* ---------- Signed in ---------- */

  $('email-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const formEl = e.currentTarget;
    submit(formEl, $('email-error'), async () => {
      const { user: next } = await api('email', { email: $('email-new').value, password: $('email-password').value });
      formEl.reset();
      formEl.closest('details').open = false;
      showUser(next);
    });
  });

  $('resend-btn').addEventListener('click', async () => {
    const resend = $('resend-btn');
    resend.disabled = true;
    try {
      await api('email/resend', {});
      resend.textContent = t('account.sentCheckInbox');
    } catch (err) {
      resend.textContent = err.message;
    }
    setTimeout(() => { resend.disabled = false; resend.textContent = t('account.resendConfirmationEmail'); }, 4000);
  });

  $('password-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const formEl = e.currentTarget;
    submit(formEl, $('pw-error'), async () => {
      await api('password', { current: $('pw-current').value, password: $('pw-new').value });
      formEl.reset();
      formEl.closest('details').open = false;
      button.textContent = t('account.passwordChanged2', { a: nameOf(user) });
      setTimeout(() => showUser(user), 2500);
    });
  });

  $('delete-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submit(e.currentTarget, $('delete-error'), async () => {
      await api('delete-account', { password: $('delete-password').value });
      e.target.reset();
      showUser(null);
      dialog.close();
    });
  });

  // Only once the server has ended the session: otherwise the account would still be signed in
  // here while looking signed out.
  $('logout-btn').addEventListener('click', async () => {
    const logoutBtn = $('logout-btn');
    logoutBtn.disabled = true;
    showError($('logout-error'), '');
    try {
      await api('logout', {});
      showUser(null);
      dialog.close();
    } catch (err) {
      showError($('logout-error'), err?.code === 'offline' || !err?.message ? t('account.signOutOffline') : err.message);
    } finally {
      logoutBtn.disabled = false;
    }
  });

  /* ---------- Opening and closing ---------- */

  $('tab-login').addEventListener('click', () => setMode('login'));
  $('tab-signup').addEventListener('click', () => setMode('signup'));
  $('account-close').addEventListener('click', () => dialog.close());
  $('account-message-ok').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); }); // backdrop
  button.addEventListener('click', () => {
    setMode('login');
    open(user ? 'member' : 'guest');
    if (!user) identifier.focus();
  });

  // Links from emails: read the token once, then take it out of the address bar and history.
  async function handleLink(me) {
    const match = location.hash.match(/^#(verify|reset)=([A-Za-z0-9_-]{20,100})$/);
    if (!match) return;
    history.replaceState(null, '', location.pathname + location.search);
    const [, kind, token] = match;
    if (kind === 'reset') {
      resetToken = token;
      open('reset');
      $('reset-password').focus();
      return;
    }
    try {
      const { user: confirmed } = await api('email/confirm', { token });
      if (confirmed) showUser(confirmed);
      else if (me) showUser((await api('me')).user);
      message(t('account.emailConfirmed'), t('account.nowResetPasswordEmail'));
    } catch (err) {
      message(t('account.linkDidnWork'), err.message);
    }
  }

  setMode('login');
  // Already signed in from an earlier visit? Without the server (opened as a plain file) this just stays signed out.
  api('me').then(({ user: current }) => {
    showUser(current);
    handleLink(current);
  }, () => showUser(null));

  // The same player with new details (e.g. a username chosen in the Friends dialog).
  return { update: (next) => showUser(next) };
}
