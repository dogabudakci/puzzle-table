// Achievements, each checked against every finished puzzle in the gallery.
// `icon` names a symbol in the index.html sprite.

export const ACHIEVEMENTS = [
  { id: 'first', icon: 'm-first', name: 'First Masterpiece', hint: 'Finish your first puzzle',
    test: (all) => all.length >= 1 },
  { id: 'collector', icon: 'm-collector', name: 'Collector', hint: 'Finish 5 puzzles',
    test: (all) => all.length >= 5 },
  { id: 'curator', icon: 'm-curator', name: 'Curator', hint: 'Finish 15 puzzles',
    test: (all) => all.length >= 15 },
  { id: 'centurion', icon: 'm-centurion', name: 'Centurion', hint: 'Finish a puzzle with 100 or more pieces',
    test: (all) => all.some((p) => p.pieces >= 100) },
  { id: 'grandmaster', icon: 'm-grandmaster', name: 'Grand Master', hint: 'Finish a puzzle with 300 or more pieces',
    test: (all) => all.some((p) => p.pieces >= 300) },
  { id: 'beat-clock', icon: 'm-clock', name: 'Beat the Clock', hint: 'Finish a countdown puzzle before time runs out',
    test: (all) => all.some((p) => p.beatClock) },
  { id: 'quick-hands', icon: 'm-quick', name: 'Quick Hands', hint: 'Finish 48 or more pieces in under 5 minutes',
    test: (all) => all.some((p) => p.pieces >= 48 && p.timeMs < 5 * 60 * 1000) },
  { id: 'unaided', icon: 'm-solo', name: 'Unaided', hint: 'Finish 48 or more pieces without a hint',
    test: (all) => all.some((p) => p.pieces >= 48 && p.hintsUsed === 0) },
  { id: 'table-hopper', icon: 'm-tables', name: 'Table Hopper', hint: 'Finish puzzles on 3 different tables',
    test: (all) => new Set(all.map((p) => p.table)).size >= 3 },
];

// Achievements the gallery now qualifies for that weren't earned before.
export function newlyEarned(puzzles, earnedIds) {
  return ACHIEVEMENTS.filter((a) => !earnedIds.has(a.id) && a.test(puzzles));
}
