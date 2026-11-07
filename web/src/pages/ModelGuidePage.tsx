import { Fragment } from "react";
import { useLoad } from "../api.ts";
import { Dots, WORK_LABEL, priceText, type Price, type Work } from "../components/ModelAdvice.tsx";
import { money } from "../components/ui.tsx";

type GuideModel = {
  id: string; group: string; label: string; example: string; tier: string; note: string; free: boolean; cloud: boolean;
  ratings: Record<Work, number>; seen: Work[]; start: Work[]; price: Price;
};
type Guide = {
  work: { id: Work; label: string; hint: string }[];
  models: GuideModel[];
  history: { model: string; kind: string; runs: number; avg_cost: number; rule: string | null }[];
};
const KIND = { plan: "plans", build: "builds", review: "reviews" } as Record<string, string>;

/** Which model for which job: where to start, and how each kind of model is rated for each kind of work. */
export function ModelGuide() {
  const { data: g } = useLoad<Guide>("/api/model-guide");
  if (!g) return <div className="page"><div className="narrow hint">Loading…</div></div>;
  const groups = [...new Set(g.models.map((m) => m.group))];
  const starters = (w: Work) => g.models.filter((m) => m.start.includes(w));
  const mine = (m: GuideModel) => g.history.filter((h) => h.rule === m.id);

  return (
    <>
      <div className="page"><div className="narrow" style={{ maxWidth: 1100 }}>
        <p>
          Which model to give which agent. If you are new, use the <b>start here</b> models and move up only when a task fails.
          When you pick a model for an agent, the form lists what your provider offers for that job, using this guide.
        </p>

        <div className="section-title"><h2>Start here</h2></div>
        <div className="card">
          {g.work.map((w, i) => (
            <div key={w.id} className="guide-start" style={i ? { borderTop: "1px solid var(--line)" } : undefined}>
              <div><b>{w.label}</b><div className="hint">{w.hint}</div></div>
              <div>
                {starters(w.id).map((m) => (
                  <div key={m.id}><b>{m.label}</b> <span className="hint">{m.price ? `$${m.price.price_in} in / $${m.price.price_out} out per M tokens` : ""}</span></div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="hint" style={{ margin: "8px 0 0" }}>
          The cheapest working team in our runs: Sonnet plans and reviews, Haiku builds. A small task cost about a cent in total.
          Planning mistakes spread to every task and the reviewer is what catches a developer's mistakes, so the better model goes there;
          both only read and write a little, so it stays cheap.
        </div>

        <div className="section-title"><h2>Ratings</h2></div>
        <div className="hint" style={{ marginBottom: 8 }}>
          Pips: three = best, two = good, one = limited, none = avoid. <b>Solid</b> pips were seen in real runs on this platform;
          <b> faded</b> pips are expectations from the model's family or size, not measured here.
        </div>
        <div className="card guide-wrap">
          <table className="guide-table">
            <thead>
              <tr><th>Model</th>{g.work.map((w) => <th key={w.id} title={w.hint}>{WORK_LABEL[w.id]}</th>)}</tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <Fragment key={group}>
                  <tr className="group-row"><td colSpan={g.work.length + 1}>{group}</td></tr>
                  {g.models.filter((m) => m.group === group).map((m) => (
                    <tr key={m.id}>
                      <td>
                        <b>{m.label}</b> <span className="hint">{m.tier}</span>
                        {m.example && <div className="mono hint">{m.example}</div>}
                        <div className="hint">{priceText(m)}</div>
                        <div className="guide-note">{m.note}</div>
                        {mine(m).length > 0 && (
                          <div className="hint">Your runs: {mine(m).map((h) => `${h.model} ${h.runs} ${KIND[h.kind] ?? h.kind}, avg ${money(h.avg_cost)}`).join(" · ")}</div>
                        )}
                      </td>
                      {g.work.map((w) => (
                        <td key={w.id}><Dots rating={m.ratings[w.id]} seen={m.seen.includes(w.id)} /></td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <div className="section-title"><h2>Good to know</h2></div>
        <ul className="guide-tips">
          <li><b>Start cheap for routine code, step up on failure.</b> Haiku is enough for most code and logic changes. If the reviewer asks for changes twice on the same task, retry it with Sonnet (Retry → with another developer).</li>
          <li><b>UI work needs more.</b> Layout, CSS and visual detail were where Haiku fell short; give those tasks to a Sonnet developer.</li>
          <li><b>Keep Opus for the hard cases.</b> It costs about twice Sonnet per token; it rarely pays off on routine work.</li>
          <li><b>Local models need small tasks.</b> One or two files per task, exact instructions, Thinking off. A 4B model pasted code into its answer instead of using the file tools and rewrote whole files; the planner for small models in the agent gallery writes tasks sized for them.</li>
          <li><b>Check what it really costs</b> on the <a href="#/usage">Usage</a> page, by agent and by model. Prices come from the price table there; add the price of any model that shows "price not set".</li>
          <li><b>The agent loop matters less than the model.</b> A public benchmark of nine coding-agent harnesses (all running the same open models, 198 tasks, three attempts each) found a plain, minimal loop tied with the big ones, while the model changed scores far more (about 70% vs 20% on the same harnesses). It also found that tasks solved on all three attempts were only about a third of the total. So: put your money into the model and the verify commands, not a fancier agent, and expect some tasks to need a retry. That benchmark did not test Claude models, so it does not change the ratings above.</li>
          <li><b>Other providers and new models:</b> models this guide does not know are rated from their name or size and marked as expected. Edit <code>server/src/modelGuide.ts</code> when your own runs say otherwise.</li>
        </ul>
      </div></div>
    </>
  );
}
