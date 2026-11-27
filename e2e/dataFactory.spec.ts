import { expect, test, type Page } from "@playwright/test";

// Read-only tests of the Data factory tabs against the demo seed (server/src/demoSeed.ts, project 1). They approve, import,
// delete, start, judge, vote and save nothing: every spec file shares one demo database.

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

// "Demo run" but not "Demo run, shorter prompt".
const DEMO_RUN = /^Demo run(?!,)/;
const TABS = [
  ["import", "Import"], ["datasets", "Datasets"], ["models", "Models"], ["judge", "Judge"],
  ["runs", "Runs"], ["review", "Review"], ["reports", "Reports"],
] as const;

test("every Data factory tab opens by address and shows its own text", async ({ page }) => {
  const problems = await signIn(page);
  const main = page.getByRole("main");
  const shows: Record<string, () => Promise<void>> = {
    import: () => expect(main.getByText("Import a dataset").first()).toBeVisible(),
    datasets: () => expect(main.getByRole("button", { name: /^support-questions/ })).toBeVisible(),
    models: () => expect(main.getByRole("button", { name: "Add model" }).first()).toBeVisible(),
    judge: () => expect(main.getByText("Scoring guide").first()).toBeVisible(),
    runs: () => expect(main.getByRole("button", { name: DEMO_RUN })).toBeVisible(),
    review: () => expect(main.getByRole("button", { name: DEMO_RUN })).toBeVisible(),
    reports: () => expect(main.getByRole("button", { name: DEMO_RUN })).toBeVisible(),
  };
  for (const [id, label] of TABS) {
    await page.goto(`/#/data-factory/1?tab=${id}`);
    await expect(page.getByRole("tab", { name: label, exact: true })).toHaveAttribute("aria-selected", "true");
    await shows[id]();
  }
  expect(problems).toEqual([]);
});

test("the header tabs change the address and the selected tab", async ({ page }) => {
  await signIn(page);
  await page.goto("/#/data-factory/1?tab=datasets");
  await page.getByRole("tab", { name: "Runs", exact: true }).click();
  await expect(page).toHaveURL(/#\/data-factory\/1\?tab=runs/);
  await expect(page.getByRole("tab", { name: "Runs", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Reports", exact: true }).click();
  await expect(page).toHaveURL(/#\/data-factory\/1\?tab=reports/);
  await expect(page.getByRole("tab", { name: "Reports", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Runs", exact: true })).toHaveAttribute("aria-selected", "false");
});

test("datasets: the unapproved sample says so and the approved one lists its cases", async ({ page }) => {
  await signIn(page);
  const main = page.getByRole("main");
  await page.goto("/#/data-factory/1?tab=datasets");
  await main.getByRole("button", { name: /^support-tickets/ }).click();
  await expect(main.getByText("Not approved", { exact: true }).first()).toBeVisible();
  await main.getByRole("button", { name: /^support-questions/ }).click();
  await expect(main.getByText("How do I reset my password?")).toBeVisible();
  await expect(main.getByText("How do I change the language?")).toBeVisible();
});

test("runs: the seeded Demo run shows its answers", async ({ page }) => {
  await signIn(page);
  const main = page.getByRole("main");
  await page.goto("/#/data-factory/1?tab=runs");
  await main.getByRole("button", { name: DEMO_RUN }).click();
  await expect(main.getByRole("heading", { name: "Answers" })).toBeVisible();
  // Each answer is the expected answer or the scripted "not sure" (evalCall.ts demoAnswer).
  const answer = /Use the 'Forgot password' link|Open Billing in your account|Check the tracking link|Yes, within one hour|Go to Settings, then Subscription|Update to the latest version|Yes, photograph the damage|Open Settings, then Language|I am not sure about this one/;
  await expect(main.getByRole("cell").filter({ hasText: answer }).first()).toBeVisible();
});

test("reports: the downloads answer and a comparison can be swapped", async ({ page }) => {
  await signIn(page);
  const main = page.getByRole("main");
  await page.goto("/#/data-factory/1?tab=reports");
  await main.getByRole("button", { name: DEMO_RUN }).click();
  for (const name of [".md", "CSV", "Excel", "JSON"]) {
    const link = main.getByRole("link", { name, exact: true });
    await expect(link).toBeVisible();
    const href = await link.getAttribute("href");
    expect(href).toBeTruthy();
    const res = await page.request.get(href!);
    expect(res.status(), name).toBe(200);
  }
  await main.getByRole("combobox", { name: "Compare with" }).click();
  await page.getByRole("option", { name: /^Demo run(, shorter prompt)? ·/ }).first().click();
  await expect(main.getByRole("button", { name: "Swap A and B" })).toBeVisible();
});
