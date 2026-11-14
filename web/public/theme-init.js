try {
  if (localStorage.getItem("agentdesk-theme") === "light") document.documentElement.classList.remove("dark");
} catch {
  // Storage can be blocked; the default theme applies.
}
