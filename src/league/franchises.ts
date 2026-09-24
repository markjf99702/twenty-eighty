import type { LeagueStructure, Park } from "./types";

/**
 * The default fictional universe: 30 franchises in two leagues of three
 * five-team divisions. Cities are real; clubs, nicknames and parks are
 * invented, so nothing here uses MLB team marks.
 */

export interface FranchiseSeed {
  city: string;
  nickname: string;
  abbrev: string;
  league: number;
  division: number;
  market: number;
  park: Park;
}

export const DEFAULT_STRUCTURE: LeagueStructure = {
  leagues: ["Continental League", "Federal League"],
  divisions: ["East", "Central", "West"],
};

type Dims = Park["dims"];
type Walls = Park["walls"];

const STANDARD: Dims = [330, 375, 400, 375, 330];
const WALL8: Walls = [8, 8, 8, 8, 8];

const park = (name: string, dims: Dims = STANDARD, walls: Walls = WALL8, altitude = 500): Park => ({
  name,
  dims,
  walls,
  altitude,
});

export const FRANCHISES: readonly FranchiseSeed[] = [
  // Continental League - East
  { city: "New York", nickname: "Empires", abbrev: "NYE", league: 0, division: 0, market: 19.5,
    park: park("Empire Grounds", [318, 385, 408, 380, 314], [8, 8, 8, 8, 8], 50) },
  { city: "Boston", nickname: "Minutemen", abbrev: "BOS", league: 0, division: 0, market: 4.9,
    park: park("Harborside Park", [310, 379, 390, 380, 302], [37, 17, 17, 5, 3], 20) },
  { city: "Philadelphia", nickname: "Founders", abbrev: "PHI", league: 0, division: 0, market: 6.2,
    park: park("Independence Yard", [329, 374, 401, 369, 330], [11, 11, 8, 13, 13], 20) },
  { city: "Montreal", nickname: "Voyageurs", abbrev: "MTL", league: 0, division: 0, market: 4.3,
    park: park("Parc du Fleuve", [325, 375, 404, 375, 325], [10, 10, 10, 10, 10], 100) },
  { city: "Baltimore", nickname: "Clippers", abbrev: "BAL", league: 0, division: 0, market: 2.8,
    park: park("Chesapeake Field", [333, 364, 400, 373, 318], [7, 13, 7, 7, 25], 30) },

  // Continental League - Central
  { city: "Chicago", nickname: "Whales", abbrev: "CHW", league: 0, division: 1, market: 9.4,
    park: park("Lakefront Park", [355, 368, 400, 368, 353], [12, 12, 11, 12, 12], 600) },
  { city: "Detroit", nickname: "Engineers", abbrev: "DET", league: 0, division: 1, market: 4.3,
    park: park("Assembly Line Field", [345, 370, 412, 365, 330], [7, 7, 9, 7, 7], 600) },
  { city: "Cleveland", nickname: "Forge", abbrev: "CLE", league: 0, division: 1, market: 2.1,
    park: park("Foundry Park", [325, 370, 405, 375, 325], [19, 19, 9, 9, 9], 650) },
  { city: "Indianapolis", nickname: "Racers", abbrev: "IND", league: 0, division: 1, market: 2.1,
    park: park("Brickyard Ballpark", [330, 375, 402, 375, 330], [8, 8, 8, 8, 8], 715) },
  { city: "Milwaukee", nickname: "Ironmen", abbrev: "MIL", league: 0, division: 1, market: 1.6,
    park: park("Riverworks Stadium", [344, 371, 400, 374, 345], [8, 8, 8, 8, 8], 600) },

  // Continental League - West
  { city: "Denver", nickname: "Summit", abbrev: "DEN", league: 0, division: 2, market: 3.0,
    park: park("Mile High Yard", [347, 390, 415, 375, 350], [8, 8, 8, 14, 14], 5200) },
  { city: "Seattle", nickname: "Sound", abbrev: "SEA", league: 0, division: 2, market: 4.0,
    park: park("Pier 46 Park", [331, 378, 401, 381, 326], [8, 8, 8, 8, 8], 20) },
  { city: "Portland", nickname: "Lumberjacks", abbrev: "POR", league: 0, division: 2, market: 2.5,
    park: park("Timberline Field", [330, 380, 405, 380, 330], [10, 10, 10, 10, 10], 100) },
  { city: "Salt Lake City", nickname: "Pioneers", abbrev: "SLC", league: 0, division: 2, market: 1.3,
    park: park("Wasatch Park", [345, 385, 420, 385, 340], [8, 8, 8, 8, 8], 4300) },
  { city: "Vancouver", nickname: "Orcas", abbrev: "VAN", league: 0, division: 2, market: 2.6,
    park: park("False Creek Field", [328, 372, 400, 372, 328], [9, 9, 9, 9, 9], 30) },

  // Federal League - East
  { city: "Brooklyn", nickname: "Ferries", abbrev: "BKN", league: 1, division: 0, market: 8.0,
    park: park("Flatbush Oval", [335, 370, 395, 360, 310], [8, 8, 8, 18, 18], 40) },
  { city: "Washington", nickname: "Statesmen", abbrev: "WAS", league: 1, division: 0, market: 6.3,
    park: park("Capitol Yards", [337, 377, 402, 370, 335], [8, 8, 8, 12, 12], 30) },
  { city: "Atlanta", nickname: "Firebirds", abbrev: "ATL", league: 1, division: 0, market: 6.2,
    park: park("Peachtree Park", [335, 385, 400, 375, 325], [8, 8, 8, 16, 16], 1000) },
  { city: "Charlotte", nickname: "Monarchs", abbrev: "CHA", league: 1, division: 0, market: 2.7,
    park: park("Queen City Field", [330, 375, 400, 375, 330], [8, 8, 8, 8, 8], 750) },
  { city: "Miami", nickname: "Barracudas", abbrev: "MIA", league: 1, division: 0, market: 6.1,
    park: park("Biscayne Dome", [344, 386, 407, 392, 335], [8, 8, 8, 8, 8], 10) },

  // Federal League - Central
  { city: "St. Louis", nickname: "Archers", abbrev: "STL", league: 1, division: 1, market: 2.8,
    park: park("Gateway Park", [336, 375, 400, 375, 335], [8, 8, 8, 8, 8], 450) },
  { city: "Nashville", nickname: "Troubadours", abbrev: "NSH", league: 1, division: 1, market: 2.0,
    park: park("Music Row Field", [325, 370, 395, 370, 325], [8, 8, 8, 8, 8], 550) },
  { city: "Kansas City", nickname: "Stockmen", abbrev: "KCS", league: 1, division: 1, market: 2.2,
    park: park("Stockyards Park", [340, 385, 410, 385, 340], [8, 8, 8, 8, 8], 900) },
  { city: "Louisville", nickname: "Thoroughbreds", abbrev: "LOU", league: 1, division: 1, market: 1.4,
    park: park("Derby Field", [325, 368, 400, 368, 325], [8, 8, 8, 8, 8], 450) },
  { city: "Dallas", nickname: "Outlaws", abbrev: "DAL", league: 1, division: 1, market: 7.8,
    park: park("Trinity Ballpark", [329, 372, 407, 374, 326], [14, 8, 8, 8, 8], 450) },

  // Federal League - West
  { city: "Los Angeles", nickname: "Stars", abbrev: "LAS", league: 1, division: 2, market: 13.0,
    park: park("Chavez Heights", [330, 375, 400, 375, 330], [4, 8, 8, 8, 4], 500) },
  { city: "San Francisco", nickname: "Fog", abbrev: "SFF", league: 1, division: 2, market: 4.6,
    park: park("Bayside Park", [339, 364, 399, 415, 309], [8, 8, 8, 20, 25], 10) },
  { city: "Las Vegas", nickname: "Jackpots", abbrev: "LVJ", league: 1, division: 2, market: 2.3,
    park: park("Neon Yard", [335, 380, 405, 380, 335], [8, 8, 8, 8, 8], 2000) },
  { city: "Phoenix", nickname: "Scorpions", abbrev: "PHX", league: 1, division: 2, market: 5.0,
    park: park("Sonoran Field", [330, 374, 407, 374, 334], [8, 8, 25, 8, 8], 1100) },
  { city: "San Diego", nickname: "Surf", abbrev: "SDS", league: 1, division: 2, market: 3.3,
    park: park("Harbor Point Park", [336, 390, 396, 391, 322], [5, 8, 8, 8, 5], 20) },
];
