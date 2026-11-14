import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// One end-to-end story on the demo seed, run in order against one server: the live sprint task finishes, a stopped task is
// retried and asks for approval, the sprint completes and is released. The scripted agents take about a minute in total.
test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

test("a sprint runs from a retried task to its release", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("tester");
  await page.getByLabel("Password").fill("password123");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Red Dust Gadgets").first()).toBeVisible();

  // Orbit's queued task runs on its own and merges into the sprint branch.
  await page.goto("/#/tasks?group=done");
  await expect(page.getByRole("button", { name: /Dust Buddy: airlock dust alarm/ })).toBeVisible({ timeout: 90_000 });

  // Comet's task is waiting for the user. Retrying it asks before a command; Allow once lets it continue to a merge.
  await page.goto("/#/tasks?group=attention");
  await page.getByText("Cocoa Printer: marshmallow mode").first().click();
  await page.getByRole("button", { name: "Retry" }).click();
  const banner = page.getByText(/Comet wants to run a command/);
  await expect(banner).toBeVisible({ timeout: 60_000 });
  // The approval banner is a state a user only reaches in this flow: scan it here.
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude('[role="tab"]').analyze();
  expect(scan.violations.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes[0]?.target.join(" ").slice(0, 140)}`)).toEqual([]);
  await page.getByRole("button", { name: "Allow once" }).click();
  await expect(banner).toBeHidden();
  await page.goto("/#/tasks?group=done");
  await expect(page.getByRole("button", { name: /Cocoa Printer: marshmallow mode/ })).toBeVisible({ timeout: 90_000 });

  // Every task merged: the sprint can be released to production.
  await page.goto("/#/scrum/1?tab=current");
  await page.getByRole("button", { name: /Sprint 2: Settling in/ }).click();
  await expect(page.getByText("3/3 merged").first()).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept()); // the release asks with the browser's confirm box
  await page.getByRole("button", { name: "Release to production" }).click();
  await page.goto("/#/scrum/1?tab=releases");
  await expect(page.getByText("Sprint 2: Settling in").first()).toBeVisible({ timeout: 60_000 });
});
