function rating(p) {
  const skill = Number(p.skill ?? 5);
  const skating = Number(p.skating ?? 5);
  const iq = Number(p.iq ?? 5);
  const stamina = Number(p.stamina ?? 5);
  const passing = Number(p.passing ?? 5);
  const shooting = Number(p.shooting ?? 5);
  return 0.35 * skill + 0.15 * skating + 0.15 * iq + 0.10 * stamina + 0.125 * passing + 0.125 * shooting;
}

export function makeTeams(players) {
  const list = players
    .map(p => ({ ...p, rating: rating(p) }))
    .sort((a, b) => b.rating - a.rating);

  const teamA = [];
  const teamB = [];
  let sumA = 0;
  let sumB = 0;

  for (const p of list) {
    if (sumA <= sumB) {
      teamA.push(p);
      sumA += p.rating;
    } else {
      teamB.push(p);
      sumB += p.rating;
    }
  }

  const meta = { sumA, sumB, diff: Math.abs(sumA - sumB), count: list.length };
  return { teamA, teamB, meta };
}
