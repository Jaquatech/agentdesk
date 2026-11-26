import { expect, test, type Page } from "@playwright/test";

// These tests read the demo seed (server/src/demoSeed.ts): a Mars-gadget team, a Scrum project, a released and an active sprint.

async function signIn(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  await page.goto("/");
  await page.getByLabel("Username").fill("tester");
  await page.getByLabel("Password").fill("password123");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Red Dust Gadgets").first()).toBeVisible();
  return problems;
}

test("every page loads without console errors", async ({ page }) => {
  const problems = await signIn(page);
  for (const route of ["#/office", "#/teams", "#/agents", "#/providers", "#/documents", "#/usage", "#/projects", "#/settings", "#/version", "#/tasks"]) {
    await page.goto(`/${route}`);
    await expect(page.getByRole("main")).toBeVisible();
    await page.waitForTimeout(300);
  }
  expect(problems).toEqual([]);
});

test("the team and agents come from the seed", async ({ page }) => {
  await signIn(page);
  await page.goto("/#/teams");
  await expect(page.getByText("Mission Control")).toBeVisible();
  for (const name of ["Nova", "Orbit", "Comet", "Sentinel"]) await expect(page.getByText(name).first()).toBeVisible();
});

test("running tasks tabs hold the sprint's tasks", async ({ page }) => {
  await signIn(page);
  await page.goto("/#/tasks?group=attention");
  await expect(page.getByText("Cocoa Printer: marshmallow mode").first()).toBeVisible();
  await page.goto("/#/tasks?group=released");
  await expect(page.getByText("Airlock door chime").first()).toBeVisible();
  await expect(page.getByText("Dust Buddy: pocket vacuum mode").first()).toBeVisible();
});

test("the Scrum page shows the backlog, the active sprint and the release", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Backlog & PIs" }).click();
  await page.getByRole("tab", { name: /Backlog/ }).click();
  await expect(page.getByText("Rover Radio: crater playlists")).toBeVisible();
  await page.getByRole("tab", { name: /Current PI/ }).click();
  await expect(page.getByText("Sprint 2: Settling in").first()).toBeVisible();
  await page.getByRole("tab", { name: /Releases/ }).click();
  await expect(page.getByText("Sprint 1: Touchdown").first()).toBeVisible();
});

test("settings shows the chat history window", async ({ page }) => {
  await signIn(page);
  await page.goto("/#/settings");
  await expect(page.getByLabel("Messages sent from a chat")).toHaveValue("16");
  await expect(page.getByText(/costs fewer tokens/)).toBeVisible();
  const summary = page.getByLabel("Agent for chat summaries");
  await expect(summary).toBeVisible();
  await expect(page.getByText(/small model is enough/)).toBeVisible();
  await summary.click();
  await page.getByRole("option", { name: "Orbit (developer)" }).click();
  await expect(summary).toContainText("Orbit (developer)");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Agent for chat summaries")).toContainText("Orbit (developer)");
  await page.getByLabel("Agent for chat summaries").click();
  await page.getByRole("option", { name: "The planner" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved")).toBeVisible();
});

test("a new chat says what carries over", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("journal");
  await expect(dialog).toContainText("wiki index");
  await expect(dialog).toContainText("task list");
  await expect(dialog).toContainText("messages");
  await page.getByRole("button", { name: "Start chat" }).click();
  await expect(page.getByRole("heading", { name: "New chat" })).toBeVisible();
});

test("a chat shows its token total", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Sprint planning" }).click();
  await expect(page.getByText(/tokens · last prompt/)).toBeVisible();
});

test("documents list the release notes and a task page", async ({ page }) => {
  await signIn(page);
  await page.goto("/#/wiki/1");
  await expect(page.getByText("Sprint 1: Touchdown").first()).toBeVisible();
  await expect(page.getByText("Airlock door chime").first()).toBeVisible();
  await page.goto("/#/documents");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByText("Airlock door chime")).toHaveCount(0);
});

test("provider test works in demo mode", async ({ page }) => {
  await signIn(page);
  await page.goto("/#/providers");
  await page.getByRole("button", { name: "Test" }).first().click();
  await expect(page.getByText(/Demo mode/).first()).toBeVisible();
});

test("a keyboard user can open a backlog item", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Backlog & PIs" }).click();
  await page.getByRole("tab", { name: /Backlog/ }).click();
  const item = page.getByRole("button", { name: /Rover Radio: crater playlists/ });
  await item.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("As a rover driver").first()).toBeVisible();
});

test("a dataset version is checked and approved before it can run", async ({ page }) => {
  await signIn(page);
  await page.goto("/#/data-factory/1?tab=datasets");
  const main = page.getByRole("main");
  await main.getByRole("button", { name: /support-tickets/ }).click();
  await expect(main.getByText("Not approved").first()).toBeVisible();
  await main.getByRole("button", { name: "Check for sensitive data" }).click();
  await expect(main.getByText("Email_1").first()).toBeVisible();
  await main.getByRole("button", { name: "Approve", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText(/permanently deleted/)).toBeVisible();
  await dialog.getByRole("button", { name: "Approve and delete" }).click();
  await expect(main.getByText(/Anonymized from v1/)).toBeVisible();
});

test("the sidebar lists the latest Data factory runs", async ({ page }) => {
  await signIn(page);
  await page.goto("/#/data-factory/1");
  const sidebar = page.getByRole("list", { name: "Latest runs" });
  await expect(sidebar.getByRole("link", { name: "View all" })).toBeVisible();
  await sidebar.getByRole("link", { name: "Demo run", exact: true }).click();
  await expect(page).toHaveURL(/#\/data-factory\/1\?tab=runs&run=\d+/);
  await expect(page.getByRole("tab", { name: "Runs" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("main").getByText("Demo run", { exact: true }).first()).toBeVisible();
});
