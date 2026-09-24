import { useApi } from "../../api/client";
import type { Status } from "../../api/protocol";
import { LEVELS, type Level } from "../../../../src/players/types";
import { ErrorNote, Loading, Section, Seg } from "../components/Common";
import { LEVEL_NAMES, gamesBack, rate3, signed, streak } from "../format";
import { go, teamHref } from "../router";

export function Standings({ level, status }: { level: Level; status: Status }) {
  const view = useApi("standings", { level }, [level]);
  const user = status.userTeamId ?? null;
  const d = view.data;
  return (
    <>
      <div class="page-head">
        <div>
          <div class="eyebrow">{status.year} standings</div>
          <h1>{LEVEL_NAMES[level]}</h1>
        </div>
        <Seg label="Level" value={level} options={LEVELS.map((l) => [l, LEVEL_NAMES[l]])} onChange={(l) => go({ page: "standings", level: l })} />
      </div>
      {level !== "MLB" && !status.minors && <div class="note warn">This league was created without minor league seasons, so affiliates don't play games.</div>}
      {view.error && <ErrorNote error={view.error} />}
      {!d && !view.error && <Loading />}
      {d && (
        <div class="grid-2">
          {d.table.map((divs, lg) => (
            <div class="section" key={lg} style={{ gap: "22px" }}>
              {divs.map((rows, dv) => (
                <Section key={dv} title={`${d.leagues[lg]!.replace(" League", "")} ${d.divisions[dv]}`}>
                  <div class="tbl-wrap">
                    <table class="tbl">
                      <thead>
                        <tr>
                          <th>Club</th>
                          <th class="num">W</th>
                          <th class="num">L</th>
                          <th class="num">Pct</th>
                          <th class="num">GB</th>
                          <th class="num" title="Runs scored">RS</th>
                          <th class="num" title="Runs allowed">RA</th>
                          <th class="num">Diff</th>
                          <th class="num">Home</th>
                          <th class="num">Road</th>
                          <th class="num">L10</th>
                          <th class="num">Strk</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.teamId} class={r.teamId === user ? "mine" : ""}>
                            <td class="name">
                              <a href={teamHref(r.teamId)}>{r.name}</a>
                            </td>
                            <td class="num">{r.w}</td>
                            <td class="num">{r.l}</td>
                            <td class="num">{rate3(r.pct)}</td>
                            <td class="num">{gamesBack(r.gb)}</td>
                            <td class="num">{r.rs}</td>
                            <td class="num">{r.ra}</td>
                            <td class="num">{signed(r.rs - r.ra)}</td>
                            <td class="num">{r.home}</td>
                            <td class="num">{r.away}</td>
                            <td class="num">{r.last10}</td>
                            <td class="num">{streak(r.streak)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              ))}
              {level === "MLB" && (
                <Section title={`${d.leagues[lg]!.replace(" League", "")} wild card`} aside="Top three make the postseason">
                  <div class="tbl-wrap">
                    <table class="tbl">
                      <thead>
                        <tr>
                          <th>Club</th>
                          <th class="num">W</th>
                          <th class="num">L</th>
                          <th class="num">WCGB</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.wildCard[lg]!.slice(0, 8).map((r, i) => (
                          <tr key={r.teamId} class={`${r.teamId === user ? "mine" : ""}${i === 2 ? " cutline" : ""}`}>
                            <td class="name">
                              <a href={teamHref(r.teamId)}>{r.name}</a>
                            </td>
                            <td class="num">{r.w}</td>
                            <td class="num">{r.l}</td>
                            <td class="num">{i < 3 ? (i === 2 ? "–" : signed(-r.gb, Number.isInteger(r.gb) ? 0 : 1)) : gamesBack(r.gb)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
