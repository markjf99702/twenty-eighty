import type { Rng } from "../core/rng";
import type { League } from "../league/types";

/**
 * 162-game schedule built from series, modeled on the post-2023 balanced
 * format:
 *   - 4 division rivals x 14 games (series of 3,4,3,4)        = 56
 *   - 10 same-league opponents x 6 games (a 3-game set each way) = 60
 *   - interleague "natural rival" x 4 (a 2-game set each way)   =  4
 *   - 14 other interleague opponents x 3 (one series)           = 42
 * Every team gets exactly 81 home games.
 */

export interface ScheduledGame {
  day: number;
  home: number;
  away: number;
}

export interface Schedule {
  days: ScheduledGame[][];
}

interface Series {
  home: number;
  away: number;
  games: number;
}

export function buildSeriesList(league: League): Series[] {
  const teams = league.teams;
  const series: Series[] = [];
  const byLeague = [0, 1].map((l) =>
    teams.filter((t) => t.league === l).sort((a, b) => a.division - b.division || a.id - b.id),
  );

  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const a = teams[i]!;
      const b = teams[j]!;
      if (a.league !== b.league) continue;
      if (a.division === b.division) {
        // 14 games: a hosts 3 + 4, b hosts 4 + 3.
        series.push({ home: a.id, away: b.id, games: 3 }, { home: b.id, away: a.id, games: 4 });
        series.push({ home: a.id, away: b.id, games: 4 }, { home: b.id, away: a.id, games: 3 });
      } else {
        series.push({ home: a.id, away: b.id, games: 3 }, { home: b.id, away: a.id, games: 3 });
      }
    }
  }

  // Interleague: team i in one league vs team j in the other. The rival
  // (same slot) is a home-and-home 2+2; the rest are single 3-game series
  // hosted by the first league's team when (j - i) mod n is 1..n/2.
  const [l0, l1] = byLeague as [typeof teams, typeof teams];
  const n = l0.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a = l0[i]!;
      const b = l1[j]!;
      const k = (((j - i) % n) + n) % n;
      if (k === 0) {
        series.push({ home: a.id, away: b.id, games: 2 }, { home: b.id, away: a.id, games: 2 });
      } else if (k <= Math.floor(n / 2)) {
        series.push({ home: a.id, away: b.id, games: 3 });
      } else {
        series.push({ home: b.id, away: a.id, games: 3 });
      }
    }
  }
  return series;
}

/**
 * Lay the series out on a calendar. Each day, teams in the middle of a
 * series keep playing; free teams are paired greedily, most-remaining-games
 * first so nobody is left with a long tail. Teams occasionally take an off
 * day between series, as real clubs do.
 */
export function buildSchedule(league: League, rng: Rng, offDayRate = 0.14): Schedule {
  const all = buildSeriesList(league);
  const remaining = new Map<number, Series[]>();
  const gamesLeft = new Map<number, number>();
  for (const t of league.teams) {
    remaining.set(t.id, []);
    gamesLeft.set(t.id, 0);
  }
  for (const s of rng.shuffle([...all])) {
    remaining.get(s.home)!.push(s);
    remaining.get(s.away)!.push(s);
    gamesLeft.set(s.home, gamesLeft.get(s.home)! + s.games);
    gamesLeft.set(s.away, gamesLeft.get(s.away)! + s.games);
  }

  const active = new Map<number, { series: Series; left: number }>();
  const days: ScheduledGame[][] = [];
  let totalLeft = all.reduce((sum, s) => sum + s.games, 0);

  for (let day = 0; totalLeft > 0 && day < 400; day++) {
    const games: ScheduledGame[] = [];
    const playing = new Set<number>();

    for (const [teamId, a] of active) {
      if (playing.has(teamId)) continue;
      const other = a.series.home === teamId ? a.series.away : a.series.home;
      games.push({ day, home: a.series.home, away: a.series.away });
      playing.add(teamId);
      playing.add(other);
    }

    const free = league.teams
      .map((t) => t.id)
      .filter((id) => !playing.has(id) && remaining.get(id)!.length > 0)
      .sort((a, b) => gamesLeft.get(b)! - gamesLeft.get(a)! || rng.next() - 0.5);
    const late = totalLeft < 200;
    for (const id of free) {
      if (playing.has(id)) continue;
      if (!late && rng.chance(offDayRate)) continue;
      const options = remaining.get(id)!.filter((s) => {
        const other = s.home === id ? s.away : s.home;
        return !playing.has(other) && free.includes(other);
      });
      if (options.length === 0) continue;
      options.sort((x, y) => {
        const ox = x.home === id ? x.away : x.home;
        const oy = y.home === id ? y.away : y.home;
        return gamesLeft.get(oy)! - gamesLeft.get(ox)!;
      });
      const s = options[0]!;
      const other = s.home === id ? s.away : s.home;
      for (const t of [id, other]) {
        const list = remaining.get(t)!;
        list.splice(list.indexOf(s), 1);
        active.set(t, { series: s, left: s.games });
      }
      games.push({ day, home: s.home, away: s.away });
      playing.add(id);
      playing.add(other);
    }

    for (const g of games) {
      for (const t of [g.home, g.away]) {
        gamesLeft.set(t, gamesLeft.get(t)! - 1);
        const a = active.get(t)!;
        a.left--;
        if (a.left === 0) active.delete(t);
      }
      totalLeft--;
    }
    days.push(games);
  }
  return { days };
}
