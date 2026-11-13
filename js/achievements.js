import { t } from './i18n.js';
// Achievements, each checked against every finished puzzle in the gallery.
// `icon` names a symbol in the index.html sprite.

export const ACHIEVEMENTS = [
  { id: 'first', icon: 'm-first', name: t('gallery.firstMasterpiece'), hint: t('gallery.finishFirstPuzzle'),
    test: (all) => all.length >= 1 },
  { id: 'collector', icon: 'm-collector', name: t('gallery.collector'), hint: t('gallery.finish5Puzzles'),
    test: (all) => all.length >= 5 },
  { id: 'curator', icon: 'm-curator', name: t('gallery.curator'), hint: t('gallery.finish15Puzzles'),
    test: (all) => all.length >= 15 },
  { id: 'centurion', icon: 'm-centurion', name: t('gallery.centurion'), hint: t('gallery.finishPuzzle100More'),
    test: (all) => all.some((p) => p.pieces >= 100) },
  { id: 'grandmaster', icon: 'm-grandmaster', name: t('gallery.grandMaster'), hint: t('gallery.finishPuzzle300More'),
    test: (all) => all.some((p) => p.pieces >= 300) },
  { id: 'beat-clock', icon: 'm-clock', name: t('gallery.beatClock2'), hint: t('gallery.finishCountdownPuzzleBefore'),
    test: (all) => all.some((p) => p.beatClock) },
  { id: 'quick-hands', icon: 'm-quick', name: t('gallery.quickHands'), hint: t('gallery.finish48MorePieces'),
    test: (all) => all.some((p) => p.pieces >= 48 && p.timeMs < 5 * 60 * 1000) },
  { id: 'unaided', icon: 'm-solo', name: t('gallery.unaided'), hint: t('gallery.finish48MorePieces2'),
    test: (all) => all.some((p) => p.pieces >= 48 && p.hintsUsed === 0) },
  { id: 'table-hopper', icon: 'm-tables', name: t('gallery.tableHopper'), hint: t('gallery.finishPuzzles3Different'),
    test: (all) => new Set(all.map((p) => p.table)).size >= 3 },
];

// Achievements the gallery now qualifies for that weren't earned before.
export function newlyEarned(puzzles, earnedIds) {
  return ACHIEVEMENTS.filter((a) => !earnedIds.has(a.id) && a.test(puzzles));
}
