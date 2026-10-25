// A game with a friend, while it's on screen: talks to the server for this match, keeps a shared
// table in step on both screens, runs the countdown, and shows how the friend is doing.
//
// Messages to the server go one at a time, in order, so a drop never overtakes the pick-up
// before it. Piece moves are sent at most about 12 times a second; the friend's screen glides
// the piece between them.

import { api } from './api.js';
import { formatTime } from './timer.js';

const $ = (id) => document.getElementById(id);
const MOVE_EVERY = 80; // ms between move updates

export class MatchSession {
  // match: from GET /api/match/<id>. hooks: { onFriendFinished(timeMs), onFriendLeft() }
  constructor(match, hooks = {}) {
    this.match = match;
    this.id = match.id;
    this.mode = match.mode;
    this.friend = match.friend.username;
    this.live = match.mode !== 'challenge';
    this.hooks = hooks;
    this.offset = match.now - Date.now(); // server clock minus this one
    this.chain = Promise.resolve();
    this.nextMove = null;
    this.moveQueued = false;
    this.game = null;
    this.ended = false;  // the friend left, or the game was decided: nothing more is sent
    this.started = false;
    this.lastShare = 0;
    this.countdownTimer = null;
  }

  serverNow() {
    return Date.now() + this.offset;
  }

  /* ---------- Sending, in order ---------- */

  enqueue(task) {
    const run = this.chain.then(task);
    this.chain = run.catch(() => {});
    return run;
  }

  post(body) {
    if (this.ended) return Promise.resolve({ ok: false });
    return api('match/event', { id: this.id, ...body }).catch((err) => {
      if (/isn't open/.test(err.message)) this.ended = true;
      if (/reach the server/.test(err.message)) this.hooks.onConnection?.(false);
      return { ok: false };
    });
  }

  send(body) {
    return this.enqueue(() => this.post(body));
  }

  queueMove(body) {
    this.nextMove = body;
    if (this.moveQueued) return;
    this.moveQueued = true;
    this.enqueue(async () => {
      await new Promise((r) => setTimeout(r, MOVE_EVERY));
      this.moveQueued = false;
      const move = this.nextMove;
      this.nextMove = null;
      if (move) await this.post(move);
    });
  }

  /* ---------- The shared table (playing together) ---------- */

  // The callbacks PuzzleGame calls while this player moves pieces on the shared table.
  sharedHooks() {
    return {
      onGrab: (group) => {
        const pieces = group.pieces.map((p) => p.index);
        this.send({ type: 'grab', pieces }).then((reply) => this.answer(reply, true));
      },
      onMove: (group) => {
        const { nx, ny } = this.game.normalized(group);
        this.queueMove({ type: 'move', piece: group.pieces[0].index, nx, ny });
      },
      onDrop: ({ pieces, nx, ny }) => {
        this.nextMove = null; // the drop says where it ended up
        this.send({ type: 'drop', pieces, nx, ny }).then((reply) => this.answer(reply));
      },
    };
  }

  // The server said no: someone else had it, or this table fell out of step with the shared one.
  answer(reply, grabbing = false) {
    if (reply.ok || !this.game || this.ended) return;
    if (grabbing) this.game.cancelDrag();
    if (reply.layout) this.game.applyLayout(reply.layout, reply.held ?? []);
  }

  attach(game) {
    this.game = game;
  }

  /* ---------- Starting together ---------- */

  // Tells the server this player is at the table; the countdown starts once both are.
  async ready() {
    this.showWaiting(true);
    const layout = this.mode === 'together' ? this.game.startLayout() : undefined; // used if this player is first
    const state = await api('match/ready', { id: this.id, layout });
    this.offset = state.now - Date.now();
    this.showFriend(state.friendOnline, state.friendProgress);
    if (state.startAt) this.begin(state);
  }

  // From the server: when the game starts, and (playing together) the shared layout.
  begin(state) {
    this.showWaiting(false);
    this.layout = state.layout;
    if (this.started) return;
    this.started = true;
    const late = this.serverNow() >= state.startAt;
    if (late && this.mode === 'together' && state.layout) {
      // Back at a game that's already going: put the table as it is now.
      $('countdown').hidden = true;
      this.game.applyLayout(state.layout, state.held?.[0]?.pieces ?? []);
      this.hooks.onStart?.(state.startAt);
      return;
    }
    if (late) {
      this.go(state.startAt);
      return;
    }
    this.countdown(state.startAt);
  }

  countdown(startAt) {
    const el = $('countdown');
    const number = $('countdown-number');
    el.hidden = false;
    const tick = () => {
      const left = startAt - this.serverNow();
      if (left <= 0) {
        number.textContent = 'Go!';
        number.classList.remove('beat');
        void number.offsetWidth;
        number.classList.add('beat');
        setTimeout(() => { el.hidden = true; }, 700);
        this.go(startAt);
        return;
      }
      const shown = String(Math.ceil(left / 1000));
      if (number.textContent !== shown) {
        number.textContent = shown;
        number.classList.remove('beat');
        void number.offsetWidth; // restart the pop animation
        number.classList.add('beat');
      }
      this.countdownTimer = setTimeout(tick, Math.min(100, left));
    };
    $('countdown-text').textContent = this.mode === 'race' ? `Race against ${this.friend}` : `Puzzling with ${this.friend}`;
    tick();
  }

  go(startAt) {
    if (this.mode === 'together' && this.layout) this.game.spillLayout = this.layout;
    this.hooks.onStart?.(startAt);
    this.game.openPouch();
  }

  showWaiting(waiting) {
    const el = $('countdown');
    el.hidden = !waiting && !this.countdownTimer;
    $('countdown-number').textContent = '';
    $('countdown-text').textContent = waiting ? `Waiting for ${this.friend} to join the table…` : '';
    el.classList.toggle('waiting', waiting);
  }

  // Back after the connection dropped: catch up with what the friend did meanwhile.
  async resync() {
    if (this.ended || !this.live || !this.game) return;
    try {
      const state = await api('match/ready', { id: this.id });
      this.offset = state.now - Date.now();
      this.showFriend(state.friendOnline, state.friendProgress);
      if (!this.started && state.startAt) return this.begin(state);
      if (this.mode === 'together' && state.layout && this.started) {
        this.game.applyLayout(state.layout, state.held?.[0]?.pieces ?? []);
      }
    } catch (err) {
      if (/isn't open/.test(err.message)) {
        this.ended = true;
        this.hooks.onEnded?.();
      }
    }
  }

  /* ---------- What the friend does ---------- */

  handle(event) {
    if (event.match !== this.id) return;
    switch (event.type) {
      case 'start':
        this.offset = event.now - Date.now();
        this.begin(event);
        break;
      case 'friend-ready':
        this.showFriend(true);
        break;
      case 'grab':
        this.game?.remoteGrab(event.pieces);
        break;
      case 'move':
        this.game?.remoteMove(event.piece, event.nx, event.ny);
        break;
      case 'drop':
        this.game?.remoteDrop(event.pieces, event.nx, event.ny);
        break;
      case 'release':
        this.game?.remoteRelease();
        break;
      case 'progress':
        this.showFriend(true, event.share);
        break;
      case 'react':
        this.hooks.onReaction?.(event.reaction);
        break;
      case 'presence':
        this.showFriend(event.online);
        if (!event.online) this.game?.remoteRelease();
        break;
      case 'finished':
        this.ended = true;
        this.hooks.onFriendFinished?.(event.timeMs);
        break;
      case 'left':
        this.ended = true;
        this.hooks.onFriendLeft?.();
        break;
      default:
    }
  }

  react(reaction) {
    if (this.ended || !this.started) return;
    this.send({ type: 'react', reaction });
  }

  // In a race, the friend's progress goes out whenever this player's grows by a step.
  progress(share) {
    if (this.mode !== 'race' || this.ended || !this.started) return;
    if (share < 1 && share - this.lastShare < 0.02) return;
    this.lastShare = share;
    this.send({ type: 'progress', share });
  }

  /* ---------- The friend's chip in the toolbar ---------- */

  showFriend(online = this.friendOnline, share = this.friendShare) {
    this.friendOnline = online;
    this.friendShare = share ?? 0;
    const chip = $('friend-chip');
    chip.hidden = false;
    chip.classList.toggle('online', Boolean(online));
    chip.classList.toggle('race', this.mode === 'race');
    $('friend-chip-name').textContent = this.mode === 'race' ? this.friend
      : this.mode === 'together' ? `with ${this.friend}` : `vs ${this.friend}`;
    $('friend-chip-fill').style.width = `${Math.round(this.friendShare * 100)}%`;
    chip.title = `${this.friend} is ${online ? 'here' : 'away'}` +
      (this.mode === 'race' ? ` · ${Math.round(this.friendShare * 100)}% done` : '');
  }

  /* ---------- Challenges ---------- */

  // The challenge clock starts (on the server) once, when the pieces first come out.
  async beginChallenge() {
    const { beganAt, now } = await api('match/begin', { id: this.id });
    this.offset = now - Date.now();
    return this.serverNow() - beganAt; // already spent, if this is a second try
  }

  async finish(result) {
    return api('match/finish', { id: this.id, ...result });
  }

  async details() {
    return (await api(`match/${this.id}`)).match;
  }

  destroy() {
    this.ended = true;
    clearTimeout(this.countdownTimer);
    $('countdown').hidden = true;
    $('friend-chip').hidden = true;
  }
}

// The line on the complete card saying who won.
export function resultLine(session, match, reply) {
  const name = session.friend;
  const mine = reply?.timeMs ?? match?.me?.timeMs;
  if (session.mode === 'together') return `Finished together with ${name}${mine ? ` in ${formatTime(mine)}` : ''}`;
  if (session.mode === 'race') {
    return reply?.late ? `${name} finished first. Well played!` : `You won the race against ${name}!`;
  }
  if (match?.status !== 'finished') return `Your time is in. ${name} hasn't played yet: we'll let you know.`;
  const theirs = match.them?.timeMs;
  const times = theirs ? ` (${formatTime(mine)} vs ${formatTime(theirs)})` : '';
  if (match.winner === 'me') return `You won the challenge against ${name}${times}!`;
  if (match.winner === 'friend') return `${name} won this one${times}. Rematch?`;
  return `A draw with ${name}${times}`;
}
