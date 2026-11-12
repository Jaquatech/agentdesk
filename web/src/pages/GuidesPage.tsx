import { BookOpen, Cpu, RefreshCcw } from "lucide-react";
import { go } from "../App.tsx";
import { Page, Section } from "../components/page.tsx";
import { ModelGuide } from "./ModelGuidePage.tsx";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const GUIDES = [
  { id: "cycle", label: "Development cycle", Icon: RefreshCcw },
  { id: "models", label: "Choosing AI models", Icon: Cpu },
] as const;

/** Guides: how work flows through the team, and which model to give which agent. */
export function GuidesPage({ tab }: { tab?: string }) {
  const current = GUIDES.find((g) => g.id === tab)?.id ?? "cycle";
  return (
    <>
      <Page title={<><BookOpen /> Guides</>} actions={
        <Tabs value={current} onValueChange={(id) => go(`guides?tab=${id}`)}>
          <TabsList>
            {GUIDES.map(({ id, label, Icon }) => (
              <TabsTrigger key={id} value={id}><Icon data-icon="inline-start" /> {label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      }>
        {current === "models" ? <ModelGuide embedded /> : <CycleGuide />}
      </Page>
    </>
  );
}

function CycleGuide() {
  return (
    <div className="flex flex-col gap-4 text-sm">
      <p>
        AgentDesk runs a project in one of two ways. Pick it per project under <a href="#/projects">Projects</a> → <b>How work is run</b>.
        Both use the same safety net: every task gets its own branch, the verify commands must pass, and a reviewer agent (QA) checks it before anything is merged.
      </p>

      <Section title="Free chat: quick changes">
        <ol className="flex list-decimal flex-col gap-1.5 pl-5">
          <li><b>You ask</b> in the project's chat. The team's planner reads the code and proposes tasks.</li>
          <li><b>You press Run plan.</b> Each task starts on its own branch and worktree.</li>
          <li><b>A developer builds it</b>, the verify commands run, the reviewer approves or asks for changes (up to the fix rounds set in Settings).</li>
          <li><b>You press Merge.</b> GitHub projects get a pull request first.</li>
        </ol>
        <p className="text-xs text-muted-foreground">Best for: a fix, a small feature, trying an idea. You decide every step.</p>
      </Section>

      <Section title="Scrum: planned work in sprints">
        <p>
          For work that is bigger than one chat: many requests, several developers, and a release at the end. Work moves through the stages below.
          The chat of a Scrum project always talks to the product manager, and a bar above it shows which stage you are in.
        </p>
        <Card>
          <CardContent className="flex flex-col">
            <Step n="1" title="Set up" who="you, once">Make a team with a planner (the <b>product manager</b>), one or more developers, a reviewer (QA), and optionally an <b>architect</b> and a <b>security reviewer</b> (Teams). The gallery on the Agents page has a Scrum product manager and an Architect. Set the project to Scrum and decide how many points one developer does per sprint (default 8).</Step>
            <Step n="2" title="Backlog" who="business owners + product manager">Optionally ask for a <b>PI</b> (a goal over several sprints) or a sprint. Then describe what is needed in the chat, in your own words: "customers need to export their order history". The product manager turns it into backlog items with a user story and acceptance criteria. You can add items at any stage and ask "review the backlog" for duplicates, gaps and a suggested order.</Step>
            <Step n="3" title="Refinement" who="automatic">Each new item goes on by itself: the <b>architect</b> reads the code and writes technical notes (approach, files, tests, a suggested developer), then a <b>developer</b> estimates the size in points (1 to 13). When that is done the item is <b>Ready</b>. An item sized 13 is too big for a task: split it. If a step fails, the item shows <i>stopped</i> with a Retry button.</Step>
            <Step n="4" title="Priority" who="you">On the Backlog page, move items up or down. The order is the order the sprint is filled in.</Step>
            <Step n="5" title="Sprint planning" who="Scrum master: automatic proposal">Create a sprint (Sprints → New sprint). The Scrum master proposes ready items in priority order until the capacity is used (<i>developers in the team × points per developer</i>). It stops at the first item that does not fit, so priority is never skipped. Untick or tick items to change the plan, then press <b>Start sprint</b>.</Step>
            <Step n="6" title="The sprint runs" who="developers + QA">The sprint gets its own git branch. Every item becomes a task: a developer builds it, the verify commands run, QA reviews it, with fix rounds as needed. An approved task is merged into the <b>sprint branch</b>, not into main. Progress messages go to the sprint's own chat. If a task stops (failed, out of rounds, or it clashes with another task's changes), retry it from Running tasks, or press <b>Close sprint</b> to send unfinished items back to the backlog.</Step>
            <Step n="7" title="Sprint complete" who="automatic">When every task has merged, the sprint is complete and the product manager writes the <b>release notes</b>. Open the sprint to read them.</Step>
            <Step n="8" title="Security review" who="optional">The security reviewer reads everything the sprint changed compared with main: secrets, injection, missing checks, risky dependencies. It reports "no blocking findings" or "issues found" with the details. Worth running before anything customer-facing; skip it for internal tools.</Step>
            <Step n="9" title="Release to production" who="you">Merges the sprint branch into the base branch and pushes it (when the project has a remote). Main is untouched until this moment. The project folder must be on the base branch with no uncommitted changes. If the push is refused (protected branch), the merge stays local and you are told.</Step>
          </CardContent>
        </Card>
      </Section>

      <Section title="Reading the numbers">
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li><b>Token use per sprint</b> is on each sprint card and adds up under the PI. It is split by kind of work: product manager, refinement, development, QA, security and release notes. Refinement of an item counts for the sprint the item went into; work before that is listed as "not in any sprint yet".</li>
          <li><b>Capacity</b> is a guide, not a promise. Points are relative: calibrate after the first sprint. If the team always finishes early, raise the points per developer; if tasks keep stopping, lower it.</li>
          <li><b>Spending limits</b> (Settings): a cap per day and one per sprint. A banner appears from 80%. At the limit, queued tasks wait and no new agent call starts; raise the limit and work carries on by itself. A task that was mid-call fails with "Budget reached": press Retry. Only finished calls are counted, and local or unpriced models count as $0.</li>
          <li><b>One sprint at a time:</b> release or close the running sprint before starting the next.</li>
        </ul>
      </Section>

      <Section title="Which model for which role">
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Role</TableHead><TableHead>Start with</TableHead><TableHead>Why</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              <TableRow><TableCell><b>Product manager</b></TableCell><TableCell>Sonnet</TableCell><TableCell>Unclear requests become unclear items for everyone downstream.</TableCell></TableRow>
              <TableRow><TableCell><b>Architect</b></TableCell><TableCell>Sonnet (Opus for hard systems)</TableCell><TableCell>Its notes are what a cheaper developer model follows; planning mistakes spread to every task.</TableCell></TableRow>
              <TableRow><TableCell><b>Developers</b></TableCell><TableCell>Haiku for code and logic, Sonnet for UI</TableCell><TableCell>Haiku is good enough for routine code at a fraction of the cost; layout and CSS need more.</TableCell></TableRow>
              <TableRow><TableCell><b>Estimating</b></TableCell><TableCell>The developer's own model</TableCell><TableCell>The same agent that would do the work sizes it.</TableCell></TableRow>
              <TableRow><TableCell><b>QA reviewer</b></TableCell><TableCell>Sonnet</TableCell><TableCell>Catches the developer's mistakes; reads little and writes little, so it stays cheap.</TableCell></TableRow>
              <TableRow><TableCell><b>Security reviewer</b></TableCell><TableCell>Sonnet (Opus for sensitive code)</TableCell><TableCell>Runs once per sprint over the whole diff, so a stronger model costs little overall.</TableCell></TableRow>
            </TableBody>
          </Table>
        </Card>
        <p className="text-xs text-muted-foreground">See <a href="#/guides?tab=models">Choosing AI models</a> for ratings of each model and what your own runs cost.</p>
      </Section>

      <Section title="Common problems">
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li><b>An item stays "refining" or shows stopped.</b> The team lacks an architect or developer, or a model failed. Fix the team, then Retry on the item.</li>
          <li><b>"No ready item fits."</b> Nothing is Ready yet, or every ready item is bigger than the capacity. Check sizes on the Backlog page.</li>
          <li><b>A task conflicts with the sprint branch.</b> Two tasks changed the same lines. Retry it after the other tasks have merged, or have the architect give tasks separate files.</li>
          <li><b>Release says the folder has uncommitted changes.</b> Commit or stash your own work in the project folder and check it is on the base branch.</li>
          <li><b>Merge says the pull request is a draft.</b> Fixed in current versions: pull requests open ready for review, and Merge marks older drafts ready first.</li>
        </ul>
      </Section>
    </div>
  );
}

function Step({ n, title, who, children }: { n: string; title: string; who: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 border-t py-3 first:border-t-0">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-sm font-medium text-primary-foreground">{n}</span>
      <div>
        <div className="flex flex-wrap items-center gap-2"><b>{title}</b> <Badge variant="secondary">{who}</Badge></div>
        <p className="mt-1 text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}
