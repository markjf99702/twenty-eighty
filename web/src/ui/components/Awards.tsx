import type { AllStarLine, AwardRow, ExecutiveRow } from "../../api/protocol";
import { playerHref } from "../router";
import { Section } from "./Common";

const GLOVES = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"];
const BATS = [...GLOVES, "DH"];

/**
 * A season's awards: the big ones (and Executive of the Year, and the
 * All-Star Game), then the Gold Gloves and Silver Sluggers position by
 * position, a column for each league.
 */
export function AwardsBlock({ awards, executives, allStar }: { awards: AwardRow[]; executives: ExecutiveRow[]; allStar: AllStarLine | null }) {
  const major = awards.filter((a) => a.pos === null);
  const leagues = [...new Set(awards.map((a) => a.league))];
  return (
    <>
      <Section title="Awards">
        <div class="tbl-wrap">
          <table class="tbl awards">
            <tbody>
              {major.map((a) => (
                <tr key={`${a.name}-${a.league}`} class={a.mine ? "mine" : ""}>
                  <td class="nowrap">
                    {a.league} {a.name}
                  </td>
                  <td class="name">
                    <a href={playerHref(a.playerId)}>{a.player}</a> <span class="muted">{a.team}</span>
                  </td>
                  <td class="dim wrap">{a.note}</td>
                </tr>
              ))}
              {executives.map((e) => (
                <tr key={`exec-${e.league}`} class={e.mine ? "mine" : ""}>
                  <td class="nowrap">{e.league} Executive of the Year</td>
                  <td class="name">{e.mine ? "You" : `${e.team} front office`}</td>
                  <td class="dim wrap">{e.note}</td>
                </tr>
              ))}
              {allStar && (
                <tr>
                  <td class="nowrap">All-Star Game</td>
                  <td>{allStar.text}</td>
                  <td class="dim wrap">
                    {allStar.mvp && (
                      <>
                        MVP <a href={playerHref(allStar.mvp.playerId)}>{allStar.mvp.name}</a> ({allStar.mvp.team}), {allStar.mvp.note}
                      </>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
      {awards.some((a) => a.pos !== null) && (
        <div class="grid-2">
          <ByPosition title="Gold Gloves" name="Gold Glove" positions={GLOVES} awards={awards} leagues={leagues} />
          <ByPosition title="Silver Sluggers" name="Silver Slugger" positions={BATS} awards={awards} leagues={leagues} />
        </div>
      )}
    </>
  );
}

function ByPosition({ title, name, positions, awards, leagues }: { title: string; name: string; positions: string[]; awards: AwardRow[]; leagues: string[] }) {
  const find = (lg: string, pos: string) => awards.find((a) => a.name === name && a.league === lg && a.pos === pos);
  return (
    <Section title={title}>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead>
            <tr>
              <th />
              {leagues.map((lg) => (
                <th key={lg}>{lg}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {positions.map((pos) => (
              <tr key={pos}>
                <td>{pos}</td>
                {leagues.map((lg) => {
                  const a = find(lg, pos);
                  return (
                    <td key={lg} class={`name${a?.mine ? " mine" : ""}`} title={a?.note}>
                      {a ? (
                        <>
                          <a href={playerHref(a.playerId)}>{a.player}</a> <span class="muted">{a.team}</span>
                        </>
                      ) : (
                        <span class="muted">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
