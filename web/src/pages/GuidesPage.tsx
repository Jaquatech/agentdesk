import { BookOpen, Cpu, RefreshCcw } from "lucide-react";
import { go } from "../App.tsx";
import { ModelGuide } from "./ModelGuidePage.tsx";

const GUIDES = [
  { id: "cycle", label: "Development cycle", Icon: RefreshCcw },
  { id: "models", label: "Choosing AI models", Icon: Cpu },
] as const;

/** Guides: how work flows through the team, and which model to give which agent. */
export function GuidesPage({ tab }: { tab?: string }) {
  const current = GUIDES.find((g) => g.id === tab)?.id ?? "cycle";
  return (
    <>
      <div className="page-head">
        <BookOpen size={16} /><h1>Guides</h1>
        <div className="tabs">
          {GUIDES.map(({ id, label, Icon }) => (
            <button key={id} className={`tab ${current === id ? "active" : ""}`} onClick={() => go(`guides?tab=${id}`)}><Icon size={14} /> {label}</button>
          ))}
        </div>
      </div>
      {current === "models" ? <ModelGuide /> : <CycleGuide />}
    </>
  );
}

function CycleGuide() {
  return (
    <div className="page"><div className="narrow" style={{ maxWidth: 900 }}>
      <p>
        AgentDesk runs a project in one of two ways. Pick it per project under <a href="#/projects">Projects</a> → <b>How work is run</b>.
        Both use the same safety net: every task gets its own branch, the verify commands must pass, and a reviewer agent (QA) checks it before anything is merged.
      </p>

      <div className="section-title"><h2>Free chat: quick changes</h2></div>
      <ol className="guide-steps">
        <li><b>You ask</b> in the project's chat. The team's planner reads the code and proposes tasks.</li>
        <li><b>You press Run plan.</b> Each task starts on its own branch and worktree.</li>
        <li><b>A developer builds it</b>, the verify commands run, the reviewer approves or asks for changes (up to the fix rounds set in Settings).</li>
        <li><b>You press Merge.</b> GitHub projects get a pull request first.</li>
      </ol>
      <div className="hint">Best for: a fix, a small feature, trying an idea. You decide every step.</div>

      <div className="section-title"><h2>Scrum: planned work in sprints</h2></div>
      <p>
        For work that is bigger than one chat: many requests, several developers, and a release at the end. Work moves through the stages below.
        The chat of a Scrum project always talks to the product manager, and a bar above it shows which stage you are in.
      </p>

      <div className="card cycle">
        <div className="cycle-step"><span className="n">1</span><div>
          <b>Set up</b> <span className="badge">you, once</span>
          <p>Make a team with a planner (the <b>product manager</b>), one or more developers, a reviewer (QA), and optionally an <b>architect</b> and a <b>security reviewer</b> (Teams). The gallery on the Agents page has a Scrum product manager and an Architect. Set the project to Scrum and decide how many points one developer does per sprint (default 8).</p>
        </div></div>
        <div className="cycle-step"><span className="n">2</span><div>
          <b>Backlog</b> <span className="badge">business owners + product manager</span>
          <p>Optionally ask for a <b>PI</b> (a goal over several sprints) or a sprint. Then describe what is needed in the chat, in your own words: "customers need to export their order history". The product manager turns it into backlog items with a user story and acceptance criteria. You can add items at any stage and ask "review the backlog" for duplicates, gaps and a suggested order.</p>
        </div></div>
        <div className="cycle-step"><span className="n">3</span><div>
          <b>Refinement</b> <span className="badge">automatic</span>
          <p>Each new item goes on by itself: the <b>architect</b> reads the code and writes technical notes (approach, files, tests, a suggested developer), then a <b>developer</b> estimates the size in points (1 to 13). When that is done the item is <b>Ready</b>. An item sized 13 is too big for a task: split it. If a step fails, the item shows <i>stopped</i> with a Retry button.</p>
        </div></div>
        <div className="cycle-step"><span className="n">4</span><div>
          <b>Priority</b> <span className="badge">you</span>
          <p>On the Backlog page, move items up or down. The order is the order the sprint is filled in.</p>
        </div></div>
        <div className="cycle-step"><span className="n">5</span><div>
          <b>Sprint planning</b> <span className="badge">Scrum master: automatic proposal</span>
          <p>Create a sprint (Sprints → New sprint). The Scrum master proposes ready items in priority order until the capacity is used (<i>developers in the team × points per developer</i>). It stops at the first item that does not fit, so priority is never skipped. Untick or tick items to change the plan, then press <b>Start sprint</b>.</p>
        </div></div>
        <div className="cycle-step"><span className="n">6</span><div>
          <b>The sprint runs</b> <span className="badge">developers + QA</span>
          <p>The sprint gets its own git branch. Every item becomes a task: a developer builds it, the verify commands run, QA reviews it, with fix rounds as needed. An approved task is merged into the <b>sprint branch</b>, not into main. Progress messages go to the sprint's own chat. If a task stops (failed, out of rounds, or it clashes with another task's changes), retry it from Running tasks, or press <b>Close sprint</b> to send unfinished items back to the backlog.</p>
        </div></div>
        <div className="cycle-step"><span className="n">7</span><div>
          <b>Sprint complete</b> <span className="badge">automatic</span>
          <p>When every task has merged, the sprint is complete and the product manager writes the <b>release notes</b>. Open the sprint to read them.</p>
        </div></div>
        <div className="cycle-step"><span className="n">8</span><div>
          <b>Security review</b> <span className="badge">optional</span>
          <p>The security reviewer reads everything the sprint changed compared with main: secrets, injection, missing checks, risky dependencies. It reports "no blocking findings" or "issues found" with the details. Worth running before anything customer-facing; skip it for internal tools.</p>
        </div></div>
        <div className="cycle-step"><span className="n">9</span><div>
          <b>Release to production</b> <span className="badge">you</span>
          <p>Merges the sprint branch into the base branch and pushes it (when the project has a remote). Main is untouched until this moment. The project folder must be on the base branch with no uncommitted changes. If the push is refused (protected branch), the merge stays local and you are told.</p>
        </div></div>
      </div>

      <div className="section-title"><h2>Reading the numbers</h2></div>
      <ul className="guide-tips">
        <li><b>Token use per sprint</b> is on each sprint card and adds up under the PI. It is split by kind of work: product manager, refinement, development, QA, security and release notes. Refinement of an item counts for the sprint the item went into; work before that is listed as "not in any sprint yet".</li>
        <li><b>Capacity</b> is a guide, not a promise. Points are relative: calibrate after the first sprint. If the team always finishes early, raise the points per developer; if tasks keep stopping, lower it.</li>
        <li><b>Spending limits</b> (Settings): a cap per day and one per sprint. A banner appears from 80%. At the limit, queued tasks wait and no new agent call starts; raise the limit and work carries on by itself. A task that was mid-call fails with "Budget reached": press Retry. Only finished calls are counted, and local or unpriced models count as $0.</li>
        <li><b>One sprint at a time:</b> release or close the running sprint before starting the next.</li>
      </ul>

      <div className="section-title"><h2>Which model for which role</h2></div>
      <div className="card guide-wrap">
        <table className="guide-table">
          <thead><tr><th>Role</th><th>Start with</th><th>Why</th></tr></thead>
          <tbody>
            <tr><td><b>Product manager</b></td><td>Sonnet</td><td>Unclear requests become unclear items for everyone downstream.</td></tr>
            <tr><td><b>Architect</b></td><td>Sonnet (Opus for hard systems)</td><td>Its notes are what a cheaper developer model follows; planning mistakes spread to every task.</td></tr>
            <tr><td><b>Developers</b></td><td>Haiku for code and logic, Sonnet for UI</td><td>Haiku is good enough for routine code at a fraction of the cost; layout and CSS need more.</td></tr>
            <tr><td><b>Estimating</b></td><td>The developer's own model</td><td>The same agent that would do the work sizes it.</td></tr>
            <tr><td><b>QA reviewer</b></td><td>Sonnet</td><td>Catches the developer's mistakes; reads little and writes little, so it stays cheap.</td></tr>
            <tr><td><b>Security reviewer</b></td><td>Sonnet (Opus for sensitive code)</td><td>Runs once per sprint over the whole diff, so a stronger model costs little overall.</td></tr>
          </tbody>
        </table>
      </div>
      <div className="hint" style={{ margin: "8px 0 24px" }}>See <a href="#/guides?tab=models">Choosing AI models</a> for ratings of each model and what your own runs cost.</div>

      <div className="section-title"><h2>Common problems</h2></div>
      <ul className="guide-tips">
        <li><b>An item stays "refining" or shows stopped.</b> The team lacks an architect or developer, or a model failed. Fix the team, then Retry on the item.</li>
        <li><b>"No ready item fits."</b> Nothing is Ready yet, or every ready item is bigger than the capacity. Check sizes on the Backlog page.</li>
        <li><b>A task conflicts with the sprint branch.</b> Two tasks changed the same lines. Retry it after the other tasks have merged, or have the architect give tasks separate files.</li>
        <li><b>Release says the folder has uncommitted changes.</b> Commit or stash your own work in the project folder and check it is on the base branch.</li>
        <li><b>Merge says the pull request is a draft.</b> Fixed in current versions: pull requests open ready for review, and Merge marks older drafts ready first.</li>
      </ul>
    </div></div>
  );
}
