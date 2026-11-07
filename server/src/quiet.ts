// Node 22.13 is the first release with node:sqlite usable without a flag; say so plainly instead of a stack trace.
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`AgentDesk needs Node.js 22.13 or newer (you have ${process.versions.node}). Install the current LTS from https://nodejs.org`);
  process.exit(1);
}

/**
 * node:sqlite prints "SQLite is an experimental feature" on every start (it is stable in practice and used
 * read/write here). Hide only that one warning; every other warning still shows. Imported first by index.ts.
 */
const original = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const text = typeof warning === "string" ? warning : warning?.message;
  if (text && text.includes("SQLite is an experimental feature")) return;
  return (original as (...a: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;
