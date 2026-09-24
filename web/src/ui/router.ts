/**
 * Hash routes. Tokens are plain letters, digits and dashes so a link to any
 * page survives being shared (e.g. #team-12, #player-4031, #stats-aaa-pitchers).
 */
import { useEffect, useState } from "preact/hooks";
import type { Level } from "../../../src/players/types";
import { LEVEL_SLUGS, levelFromSlug } from "./format";

export type Route =
  | { page: "home" }
  | { page: "standings"; level: Level }
  | { page: "team"; teamId: number | null; tab: "roster" | "depth" | "farm" | "payroll" }
  | { page: "player"; playerId: number }
  | { page: "stats"; level: Level; kind: "hitters" | "pitchers" }
  | { page: "scores"; day: number | null }
  | { page: "box"; key: string }
  | { page: "moves"; mine: boolean }
  | { page: "playoffs" }
  | { page: "winter" }
  | { page: "trades"; partnerId: number | null }
  | { page: "history" }
  | { page: "scouting" }
  | { page: "office" };

export function parse(hash: string): Route {
  const parts = hash.replace(/^#/, "").split("-");
  const [page, a, b] = parts;
  const n = (x: string | undefined) => (x !== undefined && /^\d+$/.test(x) ? Number(x) : null);
  switch (page) {
    case "standings":
      return { page: "standings", level: levelFromSlug(a) };
    case "team":
      return { page: "team", teamId: n(a), tab: b === "depth" || b === "farm" || b === "payroll" ? b : "roster" };
    case "player":
      return n(a) !== null ? { page: "player", playerId: n(a)! } : { page: "home" };
    case "stats":
      return { page: "stats", level: levelFromSlug(a), kind: b === "pitchers" ? "pitchers" : "hitters" };
    case "scores":
      return { page: "scores", day: n(a) };
    case "box":
      return n(a) !== null && n(b) !== null ? { page: "box", key: `${a}-${b}` } : { page: "scores", day: null };
    case "moves":
      return { page: "moves", mine: a === "mine" };
    case "playoffs":
      return { page: "playoffs" };
    case "office":
      return { page: "office" };
    case "winter":
      return { page: "winter" };
    case "trades":
      return { page: "trades", partnerId: n(a) };
    case "history":
      return { page: "history" };
    case "scouting":
      return { page: "scouting" };
    default:
      return { page: "home" };
  }
}

export function href(r: Route): string {
  switch (r.page) {
    case "home":
      return "#home";
    case "standings":
      return r.level === "MLB" ? "#standings" : `#standings-${LEVEL_SLUGS[r.level]}`;
    case "team":
      return r.teamId === null ? "#team" : `#team-${r.teamId}${r.tab === "roster" ? "" : `-${r.tab}`}`;
    case "player":
      return `#player-${r.playerId}`;
    case "stats":
      return `#stats-${LEVEL_SLUGS[r.level]}-${r.kind}`;
    case "scores":
      return r.day === null ? "#scores" : `#scores-${r.day}`;
    case "box":
      return `#box-${r.key}`;
    case "moves":
      return r.mine ? "#moves-mine" : "#moves";
    case "playoffs":
      return "#playoffs";
    case "office":
      return "#office";
    case "winter":
      return "#winter";
    case "trades":
      return r.partnerId === null ? "#trades" : `#trades-${r.partnerId}`;
    case "history":
      return "#history";
    case "scouting":
      return "#scouting";
  }
}

export const go = (r: Route) => {
  location.hash = href(r);
};

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(() => {
    const on = () => {
      setRoute(parse(location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export const playerHref = (id: number) => href({ page: "player", playerId: id });
export const teamHref = (id: number) => href({ page: "team", teamId: id, tab: "roster" });
