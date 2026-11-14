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

test("documents list the release notes and a task page", async ({ page }) => {
  await signIn(page);
  await page.goto("/#/documents");
  await expect(page.getByText("Sprint 1: Touchdown").first()).toBeVisible();
  await expect(page.getByText("Airlock door chime").first()).toBeVisible();
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
