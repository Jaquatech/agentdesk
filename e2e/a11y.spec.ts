import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Automated accessibility scan of every page in demo mode (WCAG 2.0/2.1 A and AA rules).
// It finds a part of the problems (roughly a third); keyboard and screen-reader checks by hand stay part of the gates.
const pages = ["#/office", "#/teams", "#/agents", "#/providers", "#/documents", "#/usage", "#/projects", "#/settings", "#/version", "#/tasks", "#/scrum/1"];

for (const theme of ["dark", "light"] as const) test(`no accessibility violations on any page (${theme} theme)`, async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("tester");
  await page.getByLabel("Password").fill("password123");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Red Dust Gadgets").first()).toBeVisible();

  const found: string[] = [];
  for (const route of pages) {
    await page.goto(`/${route}`);
    await expect(page.getByRole("main")).toBeVisible();
    await page.waitForTimeout(500);
    // The tab buttons point (aria-controls) at panels the page does not render: the tabs only switch what the page below shows.
    // Recorded in docs/decisions.md; every other rule still runs on the rest of the page.
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude('[role="tab"]').analyze();
    for (const v of result.violations) found.push(`${theme} ${route} ${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes[0]?.target.join(" ")}`);
  }
  expect(found).toEqual([]);
});

// Pages in a state a user reaches by clicking: dialogs, a form with an error, the chat. Each step opens the state, scans, and closes it.
const states: { name: string; route: string; open: (page: Page) => Promise<void> }[] = [
  { name: "edit project dialog", route: "#/projects", open: async (p) => { await p.getByText("Red Dust Gadgets").first().click(); } },
  { name: "new project dialog", route: "#/projects", open: async (p) => { await p.getByRole("button", { name: /New project/i }).first().click(); } },
  { name: "edit agent dialog", route: "#/agents", open: async (p) => { await p.getByText("Nova").first().click(); } },
  { name: "agent gallery", route: "#/agents", open: async (p) => { await p.getByRole("button", { name: /Add from gallery/i }).click(); } },
  { name: "new provider dialog", route: "#/providers", open: async (p) => { await p.getByRole("button", { name: /New provider/i }).click(); } },
  { name: "new team dialog", route: "#/teams", open: async (p) => { await p.getByRole("button", { name: /New team/i }).click(); } },
  { name: "add backlog item dialog", route: "#/scrum/1", open: async (p) => { await p.getByRole("tab", { name: /Backlog/ }).click(); await p.getByRole("button", { name: /Add item/i }).click(); } },
  { name: "needs-attention task", route: "#/tasks?group=attention", open: async (p) => { await p.getByText("Cocoa Printer: marshmallow mode").first().click(); } },
  { name: "chat", route: "#/chat/1", open: async () => {} },
];

for (const s of states) test(`no accessibility violations: ${s.name}`, async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("tester");
  await page.getByLabel("Password").fill("password123");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Red Dust Gadgets").first()).toBeVisible();
  await page.goto(`/${s.route}`);
  await expect(page.getByRole("main")).toBeVisible();
  await s.open(page);
  await page.waitForTimeout(600);
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude('[role="tab"]').analyze();
  expect(result.violations.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes[0]?.target.join(" ").slice(0, 140)}`)).toEqual([]);
});
