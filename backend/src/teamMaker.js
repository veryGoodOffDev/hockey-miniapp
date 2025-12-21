export function calcRating(p) {
  // можно менять веса под себя
  const skill = num(p.skill);
  const skating = num(p.skating);
  const iq = num(p.iq);
  const stamina = num(p.stamina);
  const passing = num(p.passing);
  const shooting = num(p.shooting);

  return 0.45*skill + 0.2*skating + 0.15*iq + 0.1*stamina + 0.05*passing + 0.05*shooting;
}

function num(x) {
  const v = Number(x);
  if (!Number.isFinite(v)) return 5;
  return Math.max(1, Math.min(10, v));
}

function sum(team) {
  return team.reduce((a, p) => a + p.rating, 0);
}

function countPos(team, pos) {
  return team.filter(p => (p.position || "F") === pos).length;
}

function scoreTeams(a, b) {
  // цель: минимальная разница сумм
  const diff = Math.abs(sum(a) - sum(b));

  // штраф за дисбаланс защитников
  const dA = countPos(a, "D");
  const dB = countPos(b, "D");
  const dPenalty = Math.abs(dA - dB) * 0.8;

  return diff + dPenalty;
}

export function makeTeams(players) {
  const enriched = players.map(p => ({
    ...p,
    rating: calcRating(p),
    position: p.position || "F"
  }));

  const goalies = enriched.filter(p => p.position === "G");
  const skaters = enriched.filter(p => p.position !== "G").sort((a,b)=>b.rating-a.rating);

  const teamA = [];
  const teamB = [];

  // вратари по одному
  if (goalies.length >= 1) teamA.push(goalies[0]);
  if (goalies.length >= 2) teamB.push(goalies[1]);
  // если больше 2 — просто добавим как игроков (или оставь как запасных)
  for (let i=2;i<goalies.length;i++) skaters.push(goalies[i]);

  // "змейка"
  for (let i=0;i<skaters.length;i++) {
    const mod = i % 4;
    if (mod === 0 || mod === 3) teamA.push(skaters[i]);
    else teamB.push(skaters[i]);
  }

  // улучшение обменами
  let bestA = [...teamA], bestB = [...teamB];
  let bestScore = scoreTeams(bestA, bestB);

  for (let iter=0; iter<250; iter++) {
    const i = randIndex(bestA);
    const j = randIndex(bestB);
    if (i < 0 || j < 0) break;

    // не свапаем вратарей, если хочешь строго 1G/команда
    if (bestA[i]?.position === "G" || bestB[j]?.position === "G") continue;

    const newA = [...bestA];
    const newB = [...bestB];
    const tmp = newA[i]; newA[i] = newB[j]; newB[j] = tmp;

    const sc = scoreTeams(newA, newB);
    if (sc < bestScore) {
      bestScore = sc;
      bestA = newA;
      bestB = newB;
    }
  }

  return {
    teamA: bestA,
    teamB: bestB,
    meta: {
      sumA: sum(bestA),
      sumB: sum(bestB),
      diff: Math.abs(sum(bestA)-sum(bestB)),
      dA: countPos(bestA,"D"),
      dB: countPos(bestB,"D"),
      gA: countPos(bestA,"G"),
      gB: countPos(bestB,"G")
    }
  };
}

function randIndex(arr) {
  if (!arr.length) return -1;
  return Math.floor(Math.random() * arr.length);
}
