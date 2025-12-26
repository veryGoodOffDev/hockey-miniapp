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
  const list = (players || [])
    .map((p) => ({ ...p, rating: rating(p) }))
    .sort((a, b) => b.rating - a.rating);

  const G = [];
  const D = [];
  const F = [];
  const U = [];

  for (const p of list) {
    const pos = String(p?.position ?? "").toUpperCase();
    if (pos === "G") G.push(p);
    else if (pos === "D") D.push(p);
    else if (pos === "F") F.push(p);
    else U.push(p);
  }

  // внутри групп тоже по силе
  for (const arr of [G, D, F, U]) arr.sort((a, b) => b.rating - a.rating);

  const teamA = [];
  const teamB = [];
  let sumA = 0;
  let sumB = 0;

  let gA = 0, dA = 0, fA = 0, uA = 0;
  let gB = 0, dB = 0, fB = 0, uB = 0;

  const addA = (p, posKey) => {
    teamA.push(p);
    sumA += p.rating;
    if (posKey === "G") gA++;
    else if (posKey === "D") dA++;
    else if (posKey === "F") fA++;
    else uA++;
  };

  const addB = (p, posKey) => {
    teamB.push(p);
    sumB += p.rating;
    if (posKey === "G") gB++;
    else if (posKey === "D") dB++;
    else if (posKey === "F") fB++;
    else uB++;
  };

  const pickTeam = (canA, canB) => {
    if (canA && !canB) return "A";
    if (!canA && canB) return "B";

    // приоритет: меньшая сумма, при равенстве — меньший размер
    if (sumA !== sumB) return sumA < sumB ? "A" : "B";
    return teamA.length <= teamB.length ? "A" : "B";
  };

  // 1) Вратари: по одному на команду (если есть 2+)
  if (G.length >= 1) addA(G.shift(), "G");
  if (G.length >= 1) addB(G.shift(), "G");

  // если вратарей больше 2 — дальше считаем их "прочими" (добьём балансом)
  const restU = [...U, ...G].sort((a, b) => b.rating - a.rating);

  // 2) Квоты D/F чтобы было поровну
  const targetDA = Math.ceil(D.length / 2);
  const targetDB = D.length - targetDA;

  const targetFA = Math.ceil(F.length / 2);
  const targetFB = F.length - targetFA;

  // 3) Раскладываем защитников с квотами
  for (const p of D) {
    const team = pickTeam(dA < targetDA, dB < targetDB);
    if (team === "A") addA(p, "D");
    else addB(p, "D");
  }

  // 4) Раскладываем нападающих с квотами
  for (const p of F) {
    const team = pickTeam(fA < targetFA, fB < targetFB);
    if (team === "A") addA(p, "F");
    else addB(p, "F");
  }

  // 5) Добиваем остальных: сначала выравниваем по количеству людей, потом по сумме
  for (const p of restU) {
    const needA = teamA.length < teamB.length;
    const needB = teamB.length < teamA.length;

    let team;
    if (needA) team = "A";
    else if (needB) team = "B";
    else team = sumA <= sumB ? "A" : "B";

    if (team === "A") addA(p, "U");
    else addB(p, "U");
  }

  const meta = {
    sumA,
    sumB,
    diff: Math.abs(sumA - sumB),
    count: list.length,
    countA: teamA.length,
    countB: teamB.length,
    posA: { G: gA, D: dA, F: fA, U: uA },
    posB: { G: gB, D: dB, F: fB, U: uB },
  };

  return { teamA, teamB, meta };
}
