// The admin page: a few numbers about the site, and the reports about players.
// The server decides who may see this (see tools/admin.py); everyone else just gets an error.

import { api } from './api.js';

const $ = (id) => document.getElementById(id);
const REASONS = {
  name: 'Offensive username',
  harassment: 'Harassment or unkind behaviour',
  spam: 'Spam or unwanted requests',
  photo: 'Inappropriate photo',
  cheating: 'Cheating',
  other: 'Something else',
};
const STAT_NAMES = {
  players: 'Players',
  newThisWeek: 'New this week',
  signedInThisWeek: 'Signed in this week',
  onlineNow: 'Online now',
  puzzlesSaved: 'Puzzles in galleries',
  gamesThisWeek: 'Games with friends this week',
  openReports: 'Open reports',
  suspended: 'Suspended',
  storageMB: 'Database size (MB of 400)',
};
const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showError(text) {
  $('admin-error').textContent = text;
  $('admin-error').hidden = !text;
}

async function load() {
  try {
    const [{ stats }, { reports }] = await Promise.all([api('admin/stats'), api('admin/reports')]);
    showError('');
    $('admin-body').hidden = false;
    $('admin-stats').replaceChildren(...Object.entries(STAT_NAMES).map(([key, label]) => {
      const box = el('div', 'admin-stat');
      box.append(el('strong', '', String(stats[key] ?? 0)), el('span', '', label));
      return box;
    }));
    $('admin-reports').replaceChildren(...reports.map(reportRow));
    $('admin-empty').hidden = reports.length > 0;
  } catch (err) {
    showError(/sign in/i.test(err.message)
      ? 'Please sign in on the main page first, with an admin account.'
      : 'This page is only for the site’s admins.');
  }
}

function reportRow(report) {
  const row = el('article', `admin-report ${report.status}`);
  const head = el('header');
  const who = el('strong', '', report.player.username ?? '(deleted account)');
  const tags = el('span', 'admin-tags');
  if (report.player.suspended) tags.append(el('span', 'tag bad', 'Suspended'));
  if (report.player.timesReported > 1) tags.append(el('span', 'tag', `Reported ${report.player.timesReported}×`));
  if (report.status !== 'open') tags.append(el('span', 'tag', 'Handled'));
  head.append(who, tags);
  const meta = el('p', 'admin-meta', `${REASONS[report.reason] ?? report.reason} · reported by ${report.reporter} · ${dateFormat.format(report.createdAt)}`);
  row.append(head, meta);
  if (report.details) row.append(el('blockquote', '', report.details));

  const actions = el('div', 'admin-actions');
  const button = (label, action, style, confirmText) => {
    const b = el('button', `btn small ${style}`, label);
    b.type = 'button';
    b.addEventListener('click', async () => {
      if (confirmText && !b.classList.contains('confirm')) {
        b.classList.add('confirm');
        b.textContent = confirmText;
        return;
      }
      b.disabled = true;
      try {
        await api('admin/report', { id: report.id, action });
        await load();
      } catch (err) {
        showError(err.message);
        b.disabled = false;
      }
    });
    return b;
  };
  if (report.status === 'open') actions.append(button('Dismiss', 'dismiss', 'ghost'));
  if (report.player.exists) {
    actions.append(report.player.suspended
      ? button('Lift suspension', 'unsuspend', 'secondary')
      : button('Suspend account', 'suspend', 'secondary', 'Click again to suspend'));
    actions.append(button('Delete account', 'delete', 'danger', 'Click again to delete for good'));
  }
  row.append(actions);
  return row;
}

load();
