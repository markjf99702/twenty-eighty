/**
 * Name pools for generated players. Names are drawn by region so first and
 * last names stay plausible together, and the regional mix loosely follows a
 * modern big-league clubhouse.
 */
import { Rng } from "../core/rng";
import type { League } from "../league/types";
import type { Player } from "./types";

interface NamePool {
  weight: number;
  first: readonly string[];
  last: readonly string[];
}

const US: NamePool = {
  weight: 0.62,
  first: [
    "Aaron", "Adam", "Aidan", "Alex", "Andrew", "Austin", "Ben", "Blake", "Bo", "Brady",
    "Brandon", "Brent", "Brett", "Brody", "Bryce", "Caleb", "Cam", "Carson", "Carter", "Chase",
    "Chris", "Clay", "Cody", "Colby", "Cole", "Colin", "Colton", "Connor", "Corbin", "Dalton",
    "Dane", "Daniel", "Darius", "David", "Derek", "Drew", "Dylan", "Eli", "Ethan", "Evan",
    "Garrett", "Gavin", "Grant", "Gunnar", "Hayden", "Hunter", "Isaac", "Jack", "Jackson", "Jake",
    "Jalen", "James", "Jared", "Jarrett", "Jason", "Jaxon", "Jordan", "Josh", "Justin", "Kade",
    "Kevin", "Kyle", "Landon", "Logan", "Lucas", "Luke", "Marcus", "Mason", "Matt", "Max",
    "Michael", "Mitch", "Nate", "Nick", "Noah", "Nolan", "Owen", "Parker", "Paul", "Peyton",
    "Reid", "Riley", "Ryan", "Sam", "Sawyer", "Scott", "Seth", "Shane", "Spencer", "Tanner",
    "Tate", "Travis", "Trent", "Trevor", "Tristan", "Tucker", "Tyler", "Wade", "Wes", "Will",
    "Zach", "Zane", "Jaylen", "Terrence", "DeShawn", "Andre", "Malik", "Xavier", "Quinn", "Rhett",
  ],
  last: [
    "Adams", "Allen", "Anderson", "Bailey", "Baker", "Barnes", "Bell", "Bennett", "Brooks", "Brown",
    "Bryant", "Burke", "Butler", "Campbell", "Carlson", "Carroll", "Carter", "Clark", "Cole", "Collins",
    "Cooper", "Cox", "Crawford", "Cruz", "Daniels", "Davis", "Dawson", "Dixon", "Dunn", "Edwards",
    "Ellis", "Evans", "Fisher", "Fleming", "Ford", "Foster", "Fowler", "Freeman", "Fuller", "Gardner",
    "Gibson", "Graham", "Grant", "Gray", "Green", "Griffin", "Hale", "Hall", "Hansen", "Harper",
    "Harris", "Hayes", "Henderson", "Holland", "Holt", "Hughes", "Hunt", "Jacobs", "James", "Jenkins",
    "Johnson", "Jones", "Keller", "Kelly", "Kennedy", "King", "Knight", "Lambert", "Lane", "Larson",
    "Lawson", "Lewis", "Lowe", "Lynch", "Marshall", "Martin", "Mason", "McCarthy", "McKinney", "Meyer",
    "Miller", "Mitchell", "Moore", "Morgan", "Morris", "Murphy", "Nelson", "Norris", "O'Brien", "Owens",
    "Palmer", "Parker", "Patterson", "Payne", "Perry", "Peterson", "Porter", "Powell", "Price", "Quinn",
    "Reed", "Reynolds", "Rhodes", "Riley", "Roberts", "Robinson", "Rogers", "Russell", "Ryan", "Sanders",
    "Schmidt", "Scott", "Shaw", "Simmons", "Snyder", "Spencer", "Stewart", "Stone", "Sullivan", "Taylor",
    "Thompson", "Tucker", "Turner", "Wagner", "Walker", "Wallace", "Walsh", "Ward", "Warren", "Watson",
    "Weaver", "Webb", "Wells", "West", "Wheeler", "White", "Williams", "Wilson", "Wolfe", "Wright",
    "Young", "Boone", "Stroud", "Kessler", "Whitaker", "Pruitt", "Lindqvist", "Novak", "Kowalski", "Brandt",
  ],
};

const LATIN: NamePool = {
  weight: 0.3,
  first: [
    "Adrián", "Alejandro", "Andrés", "Ángel", "Aníbal", "Carlos", "César", "Cristian", "Daniel", "Diego",
    "Eduardo", "Elvis", "Emilio", "Enrique", "Ezequiel", "Felipe", "Fernando", "Francisco", "Gabriel", "Gerardo",
    "Gilberto", "Gregorio", "Héctor", "Hernán", "Iván", "Jairo", "Javier", "Jesús", "Jhonny", "Joel",
    "Jorge", "José", "Juan", "Julio", "Leonel", "Luis", "Manuel", "Marcelo", "Mario", "Miguel",
    "Nelson", "Óscar", "Pablo", "Pedro", "Rafael", "Ramón", "Raúl", "Reinaldo", "Ricardo", "Roberto",
    "Rodolfo", "Rubén", "Santiago", "Sergio", "Tomás", "Víctor", "Wilmer", "Alexis", "Edwin", "Marco",
    "Yunior", "Ronny", "Elián", "Dariel", "Yeferson", "Kelvin", "Maikel", "Anderson", "Brayan", "Jefry",
  ],
  last: [
    "Acosta", "Aguilar", "Almonte", "Álvarez", "Arias", "Báez", "Batista", "Beltrán", "Castillo", "Castro",
    "Contreras", "Cordero", "Cruz", "De la Rosa", "De León", "Delgado", "Díaz", "Domínguez", "Durán", "Encarnación",
    "Espinal", "Estrada", "Feliz", "Fernández", "Figueroa", "Flores", "García", "Gómez", "González", "Guerrero",
    "Gutiérrez", "Hernández", "Herrera", "Jiménez", "León", "López", "Marte", "Martínez", "Medina", "Mejía",
    "Méndez", "Mercedes", "Miranda", "Molina", "Montero", "Morales", "Moreno", "Núñez", "Ortiz", "Pérez",
    "Peña", "Polanco", "Quintana", "Ramírez", "Ramos", "Reyes", "Rivera", "Rodríguez", "Rojas", "Romero",
    "Rosario", "Ruiz", "Sánchez", "Santana", "Santos", "Suárez", "Tapia", "Torres", "Valdez", "Vargas",
    "Vásquez", "Velázquez", "Vizcaíno", "Zapata", "Paulino", "Guzmán", "Frías", "Soriano", "Taveras", "Ureña",
  ],
};

const ASIA: NamePool = {
  weight: 0.05,
  first: [
    "Haruto", "Kenta", "Kaito", "Ren", "Shota", "Yuki", "Daichi", "Takumi", "Sora", "Hiroki",
    "Ji-ho", "Min-jun", "Seo-jun", "Hyun-woo", "Jae-won", "Dong-hyun", "Sung-min", "Tzu-wei", "Chen", "Wei",
  ],
  last: [
    "Tanaka", "Suzuki", "Sato", "Takahashi", "Watanabe", "Ito", "Yamamoto", "Nakamura", "Kobayashi", "Kato",
    "Yoshida", "Matsuda", "Kim", "Lee", "Park", "Choi", "Jung", "Kang", "Lin", "Wang",
  ],
};

const OTHER: NamePool = {
  weight: 0.03,
  first: [
    "Liam", "Oliver", "Jarred", "Ruben", "Sven", "Dirk", "Joost", "Callum", "Lachlan", "Jonathan",
    "Mitchell", "Travis", "Tom", "Lars", "Jan", "Mikkel",
  ],
  last: [
    "van der Berg", "de Wit", "Visser", "Bakker", "Mulder", "Martis", "Kingsale", "Brouwer", "Fitzgerald", "Doyle",
    "Nilsson", "Kowalczyk", "Müller", "Andersen", "O'Neill", "Byrne",
  ],
};

const POOLS: readonly NamePool[] = [US, LATIN, ASIA, OTHER];

/**
 * Well-known real players whose names these pools can produce. The universe is
 * fictional, so re-draw rather than hand out a famous name.
 */
const REAL_NAME_BLOCKLIST = new Set([
  "Aaron Judge", "Austin Riley", "Bryce Harper", "Kyle Tucker", "Logan Webb", "Josh Bell",
  "Justin Turner", "Chris Taylor", "Carlos Santana", "Miguel Rojas", "Pedro Martínez", "Juan González",
  "Luis Castillo", "Eduardo Rodríguez", "Carlos Beltrán", "Iván Rodríguez", "Julio Rodríguez", "José Ramírez",
  "Luis García", "Wilmer Flores", "Víctor Martínez", "Carlos Delgado", "Carlos Gómez", "Ramón Hernández",
  "Felipe Alou", "José Reyes", "Hanley Ramírez", "Manny Ramírez", "Rafael Furcal", "Miguel Cabrera",
  "David Ortiz", "Nelson Cruz", "Pablo López", "Jesús Sánchez", "Gary Sánchez", "Luis Arias",
  "Jorge Soler", "Jorge Polanco", "José Altuve", "Ronald Acuña", "Juan Soto", "Francisco Lindor",
  "Adam Jones", "Chris Davis", "Ryan Howard", "David Wright", "Josh Hamilton", "Matt Kemp",
  "Adrián González", "Carlos Martínez", "Kenta Maeda", "Kodai Senga", "Hyun-woo Kim", "Ji-ho Park",
  "Dylan Moore", "Wade Miller", "Will Smith", "Chase Anderson", "Jake Cronenworth", "Max Scherzer",
  // Legends, and the stars of the day.
  "Nolan Ryan", "Babe Ruth", "Willie Mays", "Hank Aaron", "Mike Trout", "Derek Jeter", "Ken Griffey", "Tony Gwynn",
  "Joe Morgan", "Frank Thomas", "Randy Johnson", "Chipper Jones", "Andruw Jones", "Mariano Rivera", "Jim Thome", "Jim Palmer",
  "Tom Seaver", "Bob Gibson", "Ernie Banks", "Mickey Mantle", "Ted Williams", "Cal Ripken", "Mike Schmidt", "George Brett",
  "Johnny Bench", "Reggie Jackson", "Ozzie Smith", "Kirby Puckett", "Roberto Clemente", "Frank Robinson", "Jackie Robinson",
  "Brooks Robinson", "Craig Biggio", "Jeff Bagwell", "Barry Larkin", "Tim Raines", "Rickey Henderson", "Dave Winfield",
  "Eddie Murray", "Paul Molitor", "Wade Boggs", "Tony Pérez", "Juan Marichal", "Orlando Cepeda", "Luis Aparicio",
  "Roberto Alomar", "Sandy Koufax", "Greg Maddux", "Tom Glavine", "John Smoltz", "Roy Halladay", "Mike Mussina",
  "Larry Walker", "Scott Rolen", "Todd Helton", "Joe Mauer", "Adrián Beltré", "Mike Piazza", "Gary Carter", "Jim Rice",
  "Andre Dawson", "Jack Morris", "Alan Trammell", "Dale Murphy", "Don Mattingly", "Mark McGwire", "Roger Clemens",
  "Barry Bonds", "Alex Rodríguez", "Albert Pujols", "Ichiro Suzuki", "Hideki Matsui", "Yu Darvish", "Masahiro Tanaka",
  "Seiya Suzuki", "Shota Imanaga", "Shohei Ohtani", "Hyun-jin Ryu", "Chan-ho Park", "Ha-seong Kim", "Jung-hoo Lee",
  "Mookie Betts", "Freddie Freeman", "Corey Seager", "Paul Goldschmidt", "Nolan Arenado", "Manny Machado", "Pete Alonso",
  "Matt Olson", "Kyle Schwarber", "José Abreu", "Gerrit Cole", "Clayton Kershaw", "Justin Verlander", "Jacob deGrom",
  "Chris Sale", "Zack Wheeler", "Blake Snell", "Corbin Burnes", "Spencer Strider", "Tyler Glasnow", "Luis Robert",
  "Bobby Witt", "Gunnar Henderson", "Adley Rutschman", "Julio Urías", "Carlos Correa", "Alex Bregman", "George Springer",
  "Marcus Semien", "Trea Turner", "Bo Bichette", "Vladimir Guerrero", "Fernando Tatis", "Yordan Álvarez", "Rafael Devers",
  "Xander Bogaerts", "Ryan Braun", "David Price", "Paul Skenes", "Jackson Holliday", "Elly De La Cruz", "Juan Pierre",
]);

export interface GeneratedName {
  first: string;
  last: string;
  /** Rough origin, used to bias handedness/age defaults later if wanted. */
  origin: "US" | "LATIN" | "ASIA" | "OTHER";
}

const ORIGINS = ["US", "LATIN", "ASIA", "OTHER"] as const;

type NameRng = { next(): number; pick<T>(xs: readonly T[]): T; weightedIndex(ws: readonly number[]): number };

function fromPool(rng: NameRng, i: number): GeneratedName {
  const pool = POOLS[i]!;
  for (;;) {
    const first = rng.pick(pool.first);
    const last = rng.pick(pool.last);
    if (!REAL_NAME_BLOCKLIST.has(`${first} ${last}`)) return { first, last, origin: ORIGINS[i]! };
  }
}

export function randomName(rng: NameRng): GeneratedName {
  return fromPool(rng, rng.weightedIndex(POOLS.map((p) => p.weight)));
}

/**
 * Give a new player whose name an active player already has (or another new
 * one does) a different name from the same pool, so no two players in the
 * league share one. Each re-draw has its own seed, so it doesn't disturb any
 * other random stream.
 */
export function uniqueNames(league: League, fresh: readonly Player[], context: string): void {
  const own = new Set(fresh);
  const taken = new Set<string>();
  for (const p of league.players) if (!own.has(p) && p.retired === undefined) taken.add(`${p.firstName} ${p.lastName}`);
  for (const p of fresh) {
    for (let tries = 0; taken.has(`${p.firstName} ${p.lastName}`) && tries < 50; tries++) {
      const pool = Math.max(0, POOLS.findIndex((x) => x.last.includes(p.lastName)));
      const n = fromPool(new Rng(`${league.seed}:name:${context}:${p.id}:${tries}`), pool);
      p.firstName = n.first;
      p.lastName = n.last;
    }
    taken.add(`${p.firstName} ${p.lastName}`);
  }
}
