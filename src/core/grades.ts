/**
 * The 20-80 scouting scale.
 *
 * 50 is major-league average and every 10 points is one standard deviation of
 * the MLB talent distribution, so a grade is just a z-score in scout clothing:
 *
 *   z = (grade - 50) / 10
 *
 * The engine works in z-scores; the UI shows grades. Scouts report in
 * 5-point steps, with 55 and 45 as the common half-grades.
 */

export const GRADE_MIN = 20;
export const GRADE_MAX = 80;
export const GRADE_MEAN = 50;
export const GRADE_SD = 10;

export function gradeToZ(grade: number): number {
  return (grade - GRADE_MEAN) / GRADE_SD;
}

export function zToGrade(z: number): number {
  return clampGrade(GRADE_MEAN + GRADE_SD * z);
}

export function clampGrade(grade: number): number {
  return Math.min(GRADE_MAX, Math.max(GRADE_MIN, grade));
}

/** Round to the nearest 5, the way grades appear on a scouting report. */
export function scoutRound(grade: number): number {
  return clampGrade(Math.round(grade / 5) * 5);
}

const LABELS: ReadonlyArray<[number, string]> = [
  [80, "Elite"],
  [70, "Plus-plus"],
  [60, "Plus"],
  [55, "Above average"],
  [50, "Average"],
  [45, "Below average"],
  [40, "Fringe"],
  [30, "Well below average"],
  [20, "Poor"],
];

export function gradeLabel(grade: number): string {
  const g = scoutRound(grade);
  for (const [floor, label] of LABELS) if (g >= floor) return label;
  return "Poor";
}

/** "45/60" style present/future notation. */
export function formatPresentFuture(present: number, future: number): string {
  return `${scoutRound(present)}/${scoutRound(future)}`;
}
