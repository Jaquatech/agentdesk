import { expect, test, type Page } from "@playwright/test";

// The composer used to forget its text when App.tsx unmounted the chat, and again on a refresh.
// "Please review the backlog" is what the demo product manager treats as a review: it adds no backlog item,
// so this does not start refinement or take a developer away from the sprint flow.

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Username").fill("tester");
  await page.getByLabel("Password").fill("password123");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Red Dust Gadgets").first()).toBeVisible();
}

const box = (page: Page) => page.getByRole("textbox");

test("an unsent message stays when you leave the chat", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Sprint planning" }).click();
  const draft = "Please review the backlog";
  await expect(box(page)).toBeVisible();
  await box(page).fill(draft);

  await page.goto("/#/documents");
  await expect(page.getByRole("main")).toBeVisible();
  await page.getByRole("link", { name: "Sprint planning" }).click();
  await expect(box(page)).toHaveValue(draft);

  await page.getByRole("tab", { name: /Running tasks/ }).click();
  await page.getByRole("tab", { name: "Chat" }).click();
  await expect(box(page)).toHaveValue(draft);

  await page.reload();
  await expect(box(page)).toHaveValue(draft);

  await page.getByRole("button", { name: "New chat" }).click();
  await expect(box(page)).toHaveValue("");
  await box(page).fill("second chat only");

  await page.getByRole("link", { name: "Sprint planning" }).click();
  await expect(box(page)).toHaveValue(draft);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(box(page)).toHaveValue("");

  await page.goto("/#/documents");
  await page.getByRole("link", { name: "Sprint planning" }).click();
  await expect(box(page)).toHaveValue("");

  await page.getByRole("link", { name: "New chat" }).click();
  await expect(box(page)).toHaveValue("second chat only");
});
