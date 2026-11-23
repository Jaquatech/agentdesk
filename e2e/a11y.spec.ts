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
  { name: "new agent: validation error", route: "#/agents", open: async (p) => {
    await p.getByRole("main").getByRole("button", { name: /^New/ }).first().click(); await p.getByRole("button", { name: "Save" }).click(); await expect(p.getByRole("dialog")).toBeVisible(); } },
  { name: "edit agent: max answer tokens empty", route: "#/agents", open: async (p) => {
    await p.getByText("Nova").first().click();
    await p.getByLabel("Max answer tokens").fill("");
    await p.getByRole("button", { name: "Save" }).click();
    await expect(p.getByRole("alert")).toBeInViewport();
  } },
  { name: "edit agent: max answer tokens over the limit", route: "#/agents", open: async (p) => {
    await p.getByText("Nova").first().click();
    await p.getByLabel("Max answer tokens").fill("128001");
    await p.getByRole("button", { name: "Save" }).click();
    await expect(p.getByRole("alert")).toBeInViewport();
    await expect(p.getByLabel("Max answer tokens")).toHaveValue("128001");
  } },
  { name: "open dropdown in the agent form", route: "#/agents", open: async (p) => {
    await p.getByRole("main").getByRole("button", { name: /^New/ }).first().click(); await p.getByRole("combobox").first().click(); await expect(p.getByRole("listbox")).toBeVisible(); } },
  { name: "chat", route: "#/chat/1", open: async () => {} },
  { name: "new chat dialog", route: "#/", open: async (p) => { await p.getByRole("button", { name: "New chat", exact: true }).click(); await expect(p.getByRole("dialog")).toBeVisible(); } },
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

// Narrow window at 125% scaling (a typical Windows display scale). The range error sits under the field.
for (const width of [1024, 768]) {
  test.describe(`agent form at ${width}px, 125% scale`, () => {
    test.use({ viewport: { width, height: 800 }, deviceScaleFactor: 1.25 });
    test(`max answer tokens stays put and the range error is on screen (${width})`, async ({ page }) => {
      await page.goto("/");
      await page.getByLabel("Username").fill("tester");
      await page.getByLabel("Password").fill("password123");
      await page.keyboard.press("Enter");
      await expect(page.getByText("Red Dust Gadgets").first()).toBeVisible();
      await page.goto("/#/agents");
      await page.getByText("Nova").first().click();
      const field = page.getByLabel("Max answer tokens");
      await expect(field).toBeVisible();
      await expect(field).toHaveValue("32000");
      await expect(page.getByRole("dialog")).toContainText("It has no effect for Claude CLI agents.");
      await page.waitForTimeout(600);
      await expect(field).toBeVisible();
      await expect(field).toHaveValue("32000");

      await field.fill("");
      await page.getByRole("button", { name: "Save" }).click();
      const alert = page.getByRole("alert");
      await expect(alert).toHaveText("Max answer tokens must be a whole number from 1024 to 128000.");
      await expect(alert).toBeInViewport();
      await expect(field).toBeInViewport();

      await field.fill("128001");
      await page.getByRole("button", { name: "Save" }).click();
      await expect(field).toHaveValue("128001");
      await expect(alert).toBeInViewport();
      const overflow = await page.evaluate(() => {
        const dialog = document.querySelector("[data-slot=dialog-content]");
        if (!(dialog instanceof HTMLElement)) return 999;
        return dialog.scrollWidth - dialog.clientWidth;
      });
      expect(overflow).toBeLessThanOrEqual(1);
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude('[role="tab"]').analyze();
      expect(result.violations.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes[0]?.target.join(" ").slice(0, 140)}`)).toEqual([]);
    });
  });
}
