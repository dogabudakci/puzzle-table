// Playing with friends: the Friends button and dialog (friends, requests, game invites and the
// list of games), and the live connection that brings requests, invites and moves as they happen.
//
// Friends find each other by username only; email addresses are never shown to anyone. The
// server decides who can see and do what (see tools/social.py); this is just the view of it.

import { api, blobToBase64 } from './api.js';
import { createPhotoLibrary } from './photoLibrary.js';
import { loadImageFile } from './imageLoader.js';
import { gridFor } from './pieceOptions.js';
import { formatTime } from './timer.js';
import { icon } from './icons.js';
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);
const VIEWS = ['name', 'main', 'new', 'pick', 'report'];
const UPLOAD_SIDE = 1400; // photos sent to a friend: sharp on screen, about 250 KB

export const MODE_NAMES = { together: t('friends.together2'), race: t('friends.race'), challenge: t('friends.challenge') };
// The same names inside a sentence (lower case, except where the language says otherwise).
const MODE_IN_TEXT = { together: 'friends.together3', race: 'friends.race2', challenge: 'friends.challenge2' };

// onPlay(matchId): open a game's table. onGameEvent(data): a move or message in a live game.
// onUserChange(user): the signed-in player's details changed (e.g. a new username).
// onConnection(online): the live connection dropped (false) or came back (true).
export function initSocial({ onPlay, onGameEvent, onUserChange, onConnection }) {
  const dialog = $('friends-dialog');
  const button = $('friends-btn');
  let user = null;
  let events = null;
  let reconnectTimer = null;
  let connected = true;
  let friends = { friends: [], incoming: [], outgoing: [], blocked: [] };
  let reporting = null; // the player being reported
  let matches = [];
  let newGame = null;  // { friend, mode, picks } while setting up an invite
  let picking = null;  // the match whose puzzle this player is picking (pick for each other)
  const awaiting = new Set(); // live games invited from this tab: join as soon as the friend accepts

  function view(name) {
    for (const v of VIEWS) $(`friends-${v}`).hidden = v !== name;
  }

  function open(tab = 'friends') {
    if (!user) return;
    if (!user.username) {
      view('name');
    } else {
      view('main');
      showTab(tab);
    }
    if (!dialog.open) dialog.showModal();
    refresh();
  }

  function showTab(tab) {
    $('tab-friends').setAttribute('aria-selected', String(tab === 'friends'));
    $('tab-games').setAttribute('aria-selected', String(tab === 'games'));
    $('panel-friends').hidden = tab !== 'friends';
    $('panel-games').hidden = tab !== 'games';
  }

  function showError(el, text) {
    el.textContent = text;
    el.hidden = !text;
  }

  /* ---------- Live connection ---------- */

  function connect() {
    disconnect();
    if (!user) return;
    events = new EventSource('/api/events');
    events.addEventListener('friends', () => refreshFriends());
    events.addEventListener('presence', (e) => {
      const { id, online } = JSON.parse(e.data);
      const friend = friends.friends.find((f) => f.id === id);
      if (friend) {
        friend.online = online;
        renderFriends();
      }
    });
    events.addEventListener('matches', (e) => {
      const data = JSON.parse(e.data);
      refreshMatches().then(() => announce(data));
    });
    events.addEventListener('game', (e) => onGameEvent?.(JSON.parse(e.data)));
    events.addEventListener('open', () => {
      refresh();
      setConnected(true);
    });
    events.onerror = () => {
      setConnected(false);
      // The browser retries by itself, unless the server refused (e.g. signed out elsewhere).
      if (events?.readyState === EventSource.CLOSED) {
        clearTimeout(reconnectTimer);
        // Refused: maybe the sign-in ended (signed out elsewhere, or expired). Then say so here too.
        reconnectTimer = setTimeout(() => {
          api('me').then(({ user: current }) => {
            if (!current) onUserChange?.(null);
            else connect();
          }, () => { reconnectTimer = setTimeout(connect, 10000); });
        }, 3000);
      }
    };
  }

  function disconnect() {
    clearTimeout(reconnectTimer);
    events?.close();
    events = null;
    setConnected(true); // signed out: nothing to be connected to
  }

  function setConnected(online) {
    if (online === connected) return;
    connected = online;
    onConnection?.(online);
  }
  window.addEventListener('offline', () => setConnected(false));
  window.addEventListener('online', () => { if (user) connect(); });

  /* ---------- Loading ---------- */

  async function refresh() {
    await Promise.all([refreshFriends(), refreshMatches()]);
  }

  async function refreshFriends() {
    if (!user?.username) return;
    try {
      friends = await api('friends');
    } catch {
      return;
    }
    renderFriends();
    showBadge();
  }

  async function refreshMatches() {
    if (!user) return;
    try {
      ({ matches } = await api('matches'));
    } catch {
      return;
    }
    renderMatches();
    showBadge();
  }

  // Things waiting for this player: friend requests, invites, and their turn in a challenge.
  function waitingCount() {
    const games = matches.filter((m) => (m.status === 'invited' && m.role === 'guest')
      || (m.status === 'accepted' && m.mode === 'challenge' && !m.me?.finished && !m.me?.gaveUp));
    return { requests: friends.incoming.length, games: games.length };
  }

  function showBadge() {
    const { requests, games } = waitingCount();
    const total = requests + games;
    $('friends-count').textContent = total;
    $('friends-count').hidden = total === 0;
    $('friends-tab-count').textContent = requests;
    $('friends-tab-count').hidden = requests === 0;
    $('games-tab-count').textContent = games;
    $('games-tab-count').hidden = games === 0;
  }

  /* ---------- Friends ---------- */

  function personRow(person, ...actions) {
    const row = document.createElement('div');
    row.className = 'person';
    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.textContent = person.username.slice(0, 1).toUpperCase();
    if (person.online !== undefined) {
      avatar.classList.toggle('online', person.online);
      avatar.title = person.online ? t('friends.onlineNow') : t('friends.offline');
    }
    const name = document.createElement('span');
    name.className = 'person-name';
    name.textContent = person.username;
    const record = describeRecord(person.record);
    if (record) {
      const line = document.createElement('small');
      line.textContent = record;
      name.append(line);
    }
    const buttons = document.createElement('span');
    buttons.className = 'person-actions';
    buttons.append(...actions);
    row.append(avatar, name, buttons);
    return row;
  }

  function actionButton(label, className, onClick, title) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn ${className}`;
    b.textContent = label;
    if (title) b.title = title;
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await onClick();
      } catch (err) {
        flash(err.message);
      } finally {
        b.disabled = false;
      }
    });
    return b;
  }

  function renderFriends() {
    const requests = $('friend-requests');
    requests.replaceChildren();
    if (friends.incoming.length) {
      const head = document.createElement('h3');
      head.className = 'mini-head';
      head.textContent = t('friends.friendRequests');
      requests.append(head, ...friends.incoming.map((p) => personRow(p,
        actionButton(t('friends.accept'), 'primary small', async () => { await api('friends/respond', { id: p.id, accept: true }); await refreshFriends(); }),
        actionButton(t('friends.decline'), 'ghost small', async () => { await api('friends/respond', { id: p.id, accept: false }); await refreshFriends(); }),
        moreMenu(p, ['block', 'report']),
      )));
    }

    const list = $('friend-list');
    list.replaceChildren();
    if (friends.friends.length) {
      const head = document.createElement('h3');
      head.className = 'mini-head';
      head.textContent = t('friends.friends');
      list.append(head, ...friends.friends.map((p) => personRow(p,
        actionButton(t('friends.play'), 'primary small', () => startNewGame(p)),
        moreMenu(p, ['remove', 'block', 'report']),
      )));
    }
    if (friends.outgoing.length) {
      const head = document.createElement('h3');
      head.className = 'mini-head';
      head.textContent = t('friends.waitingAnswer');
      list.append(head, ...friends.outgoing.map((p) => personRow(p, removeButton(p, null, t('friends.cancel')))));
    }
    if (friends.blocked?.length) {
      const head = document.createElement('h3');
      head.className = 'mini-head';
      head.textContent = t('friends.blocked');
      list.append(head, ...friends.blocked.map((p) => personRow(p,
        actionButton(t('friends.unblock'), 'ghost small', async () => { await api('friends/unblock', { id: p.id }); await refreshFriends(); }),
      )));
    }
    $('friends-empty').hidden = friends.friends.length + friends.incoming.length + friends.outgoing.length > 0;
  }

  // "You 3 – 2 · 4 together": how games with this friend went.
  function describeRecord(record) {
    if (!record) return '';
    const parts = [];
    if (record.wins || record.losses || record.draws) {
      parts.push(t('friends.text', { a: record.wins, b: record.losses }) + (record.draws ? t('friends.drawn', { a: record.draws }) : ''));
    }
    if (record.together) parts.push(t('friends.together', { a: record.together }));
    return parts.join(' · ');
  }

  // "⋯" next to a player: remove, block or report, each confirmed before it happens.
  function moreMenu(person, items) {
    const wrap = document.createElement('span');
    wrap.className = 'more';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'icon-btn more-btn';
    toggle.setAttribute('aria-label', t('friends.more', { a: person.username }));
    toggle.setAttribute('aria-expanded', 'false');
    toggle.append(icon('i-more'));
    const menu = document.createElement('div');
    menu.className = 'more-menu';
    menu.hidden = true;
    const labels = {
      remove: [t('friends.removeFriend'), t('friends.removeOpenGamesThem', { a: person.username })],
      block: [t('friends.block'), t('friends.blockWonFriendsAny', { a: person.username })],
      report: [t('friends.report'), null],
    };
    for (const item of items) {
      const [label, question] = labels[item];
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = b.dataset.label = label;
      if (item !== 'remove') b.classList.add('danger');
      b.addEventListener('click', async () => {
        if (item === 'report') {
          close();
          return openReport(person);
        }
        if (!b.classList.contains('confirm')) { // asks once, so a slip doesn't lose a friend
          b.classList.add('confirm');
          b.textContent = t('friends.tapAgainConfirm');
          b.title = question;
          return;
        }
        close();
        try {
          await api(item === 'remove' ? 'friends/remove' : 'friends/block', { id: person.id });
          await refresh();
          if (item === 'block') flash(t('friends.blocked2', { a: person.username }));
        } catch (err) {
          flash(err.message);
        }
      });
      menu.append(b);
    }
    function close() {
      menu.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      for (const b of menu.children) {
        b.classList.remove('confirm');
        b.textContent = b.dataset.label;
      }
      document.removeEventListener('click', outside, true);
    }
    function outside(e) {
      if (!wrap.contains(e.target)) close();
    }
    toggle.addEventListener('click', () => {
      if (!menu.hidden) return close();
      menu.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      document.addEventListener('click', outside, true);
    });
    wrap.append(toggle, menu);
    return wrap;
  }

  /* ---------- Reporting ---------- */

  function openReport(person) {
    reporting = person;
    $('report-name').textContent = person.username;
    $('report-form').reset();
    $('report-block').checked = true;
    showError($('report-error'), '');
    $('report-done').hidden = true;
    $('report-form').hidden = false;
    view('report');
  }

  $('report-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const reason = new FormData(e.currentTarget).get('reason');
    if (!reason) return showError($('report-error'), t('report.chooseReason'));
    const submit = e.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await api('report', { id: reporting.id, reason, details: $('report-details').value, block: $('report-block').checked });
      $('report-form').hidden = true;
      $('report-done').hidden = false;
      refresh();
    } catch (err) {
      showError($('report-error'), err.message);
    } finally {
      submit.disabled = false;
    }
  });
  $('report-back').addEventListener('click', () => { view('main'); showTab('friends'); });
  $('report-ok').addEventListener('click', () => { view('main'); showTab('friends'); });

  // Asks once before removing (the button turns into "Sure?"), so a slip doesn't lose a friend.
  function removeButton(person, question, label = t('gallery.remove')) {
    const b = actionButton(label, 'ghost small', async () => {
      if (question && !b.classList.contains('confirm')) {
        b.classList.add('confirm');
        b.textContent = t('friends.sure');
        b.title = question;
        setTimeout(() => { b.classList.remove('confirm'); b.textContent = label; }, 3000);
        return;
      }
      await api('friends/remove', { id: person.id });
      await refresh();
    });
    return b;
  }

  $('add-friend-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('add-friend-input');
    const done = $('add-friend-done');
    done.hidden = true;
    showError($('add-friend-error'), '');
    try {
      const { result } = await api('friends/request', { username: input.value });
      done.textContent = result === 'accepted'
        ? t('friends.areFriendsNow', { a: input.value.trim() })
        : t('friends.requestSentOnceAccepts', { a: input.value.trim() });
      done.hidden = false;
      input.value = '';
      refreshFriends();
    } catch (err) {
      showError($('add-friend-error'), err.message);
    }
  });

  $('username-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    showError($('username-error'), '');
    try {
      const { user: next } = await api('username', { username: $('username-input').value });
      setUser(next);
      onUserChange?.(next);
      open();
    } catch (err) {
      showError($('username-error'), err.message);
    }
  });

  /* ---------- Games ---------- */

  function describe(m) {
    const name = m.friend.username;
    const mine = m.me?.timeMs;
    const theirs = m.them?.timeMs;
    if (m.status === 'invited') {
      return m.role === 'guest' ? t('friends.invited', { a: name }) : t('friends.waitingAnswer2', { a: name });
    }
    if (m.status === 'declined') return t('friends.saidNoTime', { a: name });
    if (m.status === 'cancelled') return t('friends.cancelled');
    if (m.status === 'finished') {
      if (m.mode === 'together') return mine ? t('friends.finishedTogether', { a: formatTime(mine) }) : t('friends.finishedTogether2');
      const outcome = m.winner === 'me' ? t('friends.won') : m.winner === 'friend' ? t('friends.won2', { a: name }) : t('friends.draw');
      return mine && theirs ? `${outcome} · ${t('friends.vs', { a: formatTime(mine), b: formatTime(theirs) })}` : outcome;
    }
    // accepted
    if (m.mode === 'challenge') {
      if (m.me?.finished) return t('friends.timeWaitingPlay', { a: formatTime(mine), b: name });
      if (m.me?.started) return t('friends.startedClockRunning');
      return m.them?.finished ? t('friends.hasPlayedTurn', { a: name }) : t('friends.turnPlayWheneverLike');
    }
    return m.startedAt ? t('friends.progress') : t('friends.readyJoinTable', { a: name });
  }

  function matchRow(m) {
    const row = document.createElement('div');
    row.className = `game-row ${m.status}`;
    if (m.winner === 'me') row.classList.add('won');
    const badge = document.createElement('span');
    badge.className = `mode-badge ${m.mode}`;
    badge.append(icon(`i-${m.mode}`));
    const text = document.createElement('span');
    text.className = 'game-text';
    const title = document.createElement('strong');
    title.textContent = t(`friends.${m.mode}With`, { a: m.friend.username });
    const detail = document.createElement('span');
    detail.textContent = `${describe(m)} · ${t('start.pieces2', { a: m.pieces })}${m.picks === 'swap' ? ` · ${t('friends.pickedEachOther')}` : ''}`;
    text.append(title, detail);
    const actions = document.createElement('span');
    actions.className = 'person-actions';

    if (m.status === 'invited' && m.role === 'guest') {
      actions.append(
        actionButton(m.picks === 'swap' ? t('friends.pickAccept') : t('friends.accept'), 'primary small', () => acceptInvite(m)),
        actionButton(t('friends.decline'), 'ghost small', async () => { await api('match/respond', { id: m.id, accept: false }); await refreshMatches(); }),
      );
    } else if (m.status === 'invited') {
      actions.append(actionButton(t('friends.cancel'), 'ghost small', () => leave(m)));
    } else if (m.status === 'accepted') {
      const played = m.me?.finished || m.me?.gaveUp;
      if (!played) {
        const label = m.mode === 'challenge' ? (m.me?.started ? t('start.continue') : t('friends.play')) : t('friends.joinTable');
        actions.append(actionButton(label, 'primary small', () => play(m.id)));
      }
      if (!played) actions.append(actionButton(m.mode === 'together' ? t('friends.leave') : t('friends.giveUp'), 'ghost small', () => leave(m)));
    }
    row.append(badge, text, actions);
    return row;
  }

  async function leave(m) {
    await api('match/leave', { id: m.id });
    await refreshMatches();
  }

  function renderMatches() {
    const list = $('game-list');
    const open = matches.filter((m) => m.status === 'invited' || m.status === 'accepted');
    const past = matches.filter((m) => !open.includes(m));
    list.replaceChildren();
    if (open.length) list.append(heading(t('friends.openGames')), ...open.map(matchRow));
    if (past.length) list.append(heading(t('friends.earlier')), ...past.slice(0, 15).map(matchRow));
    $('games-empty').hidden = matches.length > 0;
  }

  function heading(text) {
    const h = document.createElement('h3');
    h.className = 'mini-head';
    h.textContent = text;
    return h;
  }

  function play(matchId) {
    dialog.close();
    hideNotice();
    onPlay(matchId);
  }

  async function acceptInvite(m) {
    if (m.picks === 'swap') {
      picking = m;
      $('pick-friend').textContent = m.friend.username;
      $('pick-sub').textContent = t('friends.pickedPuzzleNowPick', { a: m.friend.username, b: m.pieces });
      showError($('pick-error'), '');
      pickPicker.reset();
      view('pick');
      return;
    }
    await api('match/respond', { id: m.id, accept: true });
    await refreshMatches();
    if (m.mode !== 'challenge') play(m.id); // live games: straight to the table
  }

  /* ---------- A new game ---------- */

  // `preset` ({ mode, picks, pieces }) starts from an earlier game's settings (a rematch).
  function startNewGame(friend, preset = {}) {
    newGame = { friend, mode: preset.mode ?? 'together', picks: preset.picks ?? 'same' };
    $('new-game-friend').textContent = friend.username;
    showError($('new-game-error'), '');
    newPicker.reset();
    if (preset.pieces) {
      const select = $('mp-pieces');
      const options = [...select.options].map((o) => Number(o.value));
      select.value = String(options.reduce((best, n) => (Math.abs(n - preset.pieces) < Math.abs(best - preset.pieces) ? n : best)));
    }
    showNewGame();
    view('new');
  }

  function showNewGame() {
    for (const b of document.querySelectorAll('#mode-picker [data-mode]')) {
      b.setAttribute('aria-checked', String(b.dataset.mode === newGame.mode));
    }
    const together = newGame.mode === 'together';
    $('picks-row').hidden = together;
    for (const b of document.querySelectorAll('#picks-row [data-picks]')) {
      b.setAttribute('aria-pressed', String(b.dataset.picks === newGame.picks));
    }
    const swap = !together && newGame.picks === 'swap';
    $('photo-head').textContent = swap ? t('friends.photo', { a: newGame.friend.username }) : t('friends.photoBoth');
    $('photo-note').textContent = swap ? t('friends.picksYoursWhenThey', { a: newGame.friend.username }) : '';
    $('send-invite').textContent = newGame.mode === 'challenge' ? t('friends.sendChallenge') : t('friends.sendInvite');
  }

  $('mode-picker').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    newGame.mode = b.dataset.mode;
    showNewGame();
  });
  $('picks-row').addEventListener('click', (e) => {
    const b = e.target.closest('[data-picks]');
    if (!b) return;
    newGame.picks = b.dataset.picks;
    showNewGame();
  });
  $('new-game-back').addEventListener('click', () => { view('main'); showTab('friends'); });
  $('pick-back').addEventListener('click', () => { view('main'); showTab('games'); });

  $('send-invite').addEventListener('click', async () => {
    const send = $('send-invite');
    showError($('new-game-error'), '');
    const pieces = Number($('mp-pieces').value);
    send.disabled = true;
    try {
      const puzzle = await newPicker.puzzle(pieces);
      const { mode, friend } = newGame;
      const { id } = await api('match/create', { friend: friend.id, mode, picks: newGame.picks, pieces, puzzle });
      if (mode !== 'challenge') awaiting.add(id);
      await refreshMatches();
      view('main');
      showTab('games');
    } catch (err) {
      showError($('new-game-error'), err.message);
    } finally {
      send.disabled = false;
    }
  });

  $('pick-accept').addEventListener('click', async () => {
    const b = $('pick-accept');
    showError($('pick-error'), '');
    b.disabled = true;
    try {
      const puzzle = await pickPicker.puzzle(picking.pieces);
      await api('match/respond', { id: picking.id, accept: true, puzzle });
      await refreshMatches();
      if (picking.mode !== 'challenge') play(picking.id);
      else {
        view('main');
        showTab('games');
      }
    } catch (err) {
      showError($('pick-error'), err.message);
    } finally {
      b.disabled = false;
    }
  });

  const newPicker = createPhotoPicker($('mp-photo'));
  const pickPicker = createPhotoPicker($('pick-photo'));

  /* ---------- Notices ---------- */

  // Tells the player about invites and answers, wherever they are in the app.
  function announce(data) {
    const m = matches.find((x) => x.id === (data.invite || data.accepted || data.declined || data.finished));
    if (!m) return;
    const name = m.friend.username;
    if (data.invite) {
      notice(t('friends.invitedPieces', { a: name, b: t(MODE_IN_TEXT[m.mode]), c: m.pieces }), t('friends.open'), () => open('games'));
    } else if (data.accepted && m.mode !== 'challenge') {
      // Invited from here and not busy with another game: straight to the table.
      if (awaiting.delete(m.id) && !playingMatch?.()) play(m.id);
      else notice(t('friends.table', { a: name }), t('friends.join'), () => play(m.id), { keep: true });
    } else if (data.accepted) {
      notice(t('friends.acceptedChallenge', { a: name }), t('friends.play'), () => play(m.id));
    } else if (data.declined) {
      notice(t('friends.playRightNow', { a: name }));
    } else if (data.finished && m.mode === 'challenge') {
      const outcome = m.winner === 'me' ? t('friends.wonChallenge') : m.winner === 'friend' ? t('friends.wonChallenge2', { a: name }) : t('friends.draw');
      notice(outcome, t('friends.see'), () => open('games'));
    }
  }

  let noticeTimer = null;
  function notice(text, action, onAction, { keep = false } = {}) {
    if (playingMatch?.() && !keep) return; // don't interrupt a live game for news
    $('notice-text').textContent = text;
    const b = $('notice-action');
    b.hidden = !action;
    b.textContent = action ?? '';
    b.onclick = () => { hideNotice(); onAction?.(); };
    $('notice').hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(hideNotice, keep ? 30000 : 9000);
  }
  function hideNotice() {
    $('notice').hidden = true;
  }
  $('notice-close').addEventListener('click', hideNotice);

  // A short message in the dialog, e.g. when an action failed.
  function flash(text) {
    notice(text);
  }

  /* ---------- Opening, signing in and out ---------- */

  $('tab-friends').addEventListener('click', () => showTab('friends'));
  $('tab-games').addEventListener('click', () => showTab('games'));
  $('friends-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  button.addEventListener('click', () => open());

  function setUser(next) {
    const changed = (next?.id ?? null) !== (user?.id ?? null);
    user = next;
    button.hidden = !user;
    if (user?.username) $('my-username').textContent = user.username;
    if (!changed) return;
    friends = { friends: [], incoming: [], outgoing: [], blocked: [] };
    matches = [];
    showBadge();
    if (dialog.open) dialog.close();
    hideNotice();
    if (user) connect();
    else disconnect();
  }

  let playingMatch = null;
  return {
    setUser,
    open,
    // Opens "Play with …" set up like the game just played, to pick a photo and go again.
    rematch(friend, preset) {
      if (!user) return;
      open('friends');
      startNewGame(friend, preset);
    },
    refreshMatches,
    notice,
    // Lets the notices know when a live game is on screen (so they stay quiet).
    setPlaying(fn) { playingMatch = fn; },
  };
}

/* ---------- Picking a photo for a game ---------- */

// The photo library plus "your own photo". `puzzle(pieces)` gives what the server needs.
function createPhotoPicker(container) {
  let choice = null; // { libraryId, name, width, height } or { file, name, canvas }
  const status = document.createElement('p');
  status.className = 'picker-status';

  const library = createPhotoLibrary((photo) => {
    choice = { libraryId: photo.id, name: photo.name, width: photo.width, height: photo.height };
    library.select(photo.id);
    show();
  });
  library.element.classList.add('compact');

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.hidden = true;
  const upload = document.createElement('button');
  upload.type = 'button';
  upload.className = 'btn secondary small';
  upload.append(icon('i-upload'), t('friends.useOwnPhoto'));
  upload.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    try {
      const photo = await loadImageFile(file);
      URL.revokeObjectURL(photo.url);
      choice = { file, name: file.name.replace(/\.[^.]+$/, ''), canvas: photo.canvas, width: photo.width, height: photo.height };
      library.select(null);
      show();
    } catch (err) {
      status.textContent = err.message;
    }
  });

  function show() {
    status.textContent = choice ? t('friends.picked', { a: choice.name }) : t('friends.pickPhotoFromLibrary');
    status.classList.toggle('picked', Boolean(choice));
  }

  const row = document.createElement('div');
  row.className = 'picker-row';
  row.append(status, upload, input);
  // The grid scrolls inside its own box, so every thumbnail keeps its full size.
  const scroller = document.createElement('div');
  scroller.className = 'picker-scroll';
  scroller.append(library.element);
  container.append(scroller, row);
  show();

  return {
    reset() {
      choice = null;
      library.select(null);
      show();
    },
    async puzzle(pieces) {
      if (!choice) throw new Error(t('friends.pleasePickPhotoFirst'));
      const { cols, rows } = gridFor(pieces, choice.width / choice.height);
      if (choice.libraryId) return { libraryId: choice.libraryId, name: choice.name, cols, rows };
      return { image: await blobToBase64(await shrink(choice.canvas)), name: choice.name, cols, rows };
    },
  };
}

function shrink(source) {
  const scale = Math.min(1, UPLOAD_SIDE / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
}
