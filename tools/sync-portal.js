// Peccino portal → team app sync.
// Usage: node sync-portal.js <portal index.html> <members dir> <events dir> <out dir> [extgames versions.json] [profiles versions.json]
//   members/events dirs: ArtifactData `list` output (one JSON file per doc).
// Writes <out>/extgames/<gameId>.json (one doc per game), <out>/event-links.json
// (app events to attach results to) and prints a summary.
const fs = require("fs"), path = require("path");
const [html, memDir, evDir, out, extDir, profDir] = process.argv.slice(2);

const { parseHtml, convert, norm } = require("./portal-convert.js");
const data = parseHtml(fs.readFileSync(html, "utf8"));

const readDir = (d) => fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(".json")).map((f) => {
  const j = JSON.parse(fs.readFileSync(path.join(d, f), "utf8"));
  return { id: j.id ?? path.basename(f, ".json"), ...(j.data ?? j) };
}) : [];
const members = readDir(memDir), events = readDir(evDir);
const { games, profiles, unmatchedRoster } = convert(data, members);
fs.mkdirSync(path.join(out, "extgames"), { recursive: true });
for (const g of Object.values(games)) fs.writeFileSync(path.join(out, "extgames", g.gameId + ".json"), JSON.stringify(g));

// attach results to app schedule events of the same date (and opponent, when several games share a date)
const links = [];
for (const e of events) {
  if (e.type !== "game" || !e.date) continue;
  const same = Object.values(games).filter((g) => g.date === e.date);
  const pick = same.length === 1 ? same[0] : same.find((g) => norm(g.opponent) === norm(e.opponent));
  if (pick && pick.result) links.push({ eventId: e.id, gameId: pick.gameId, result: pick.result });
}
fs.writeFileSync(path.join(out, "event-links.json"), JSON.stringify(links, null, 1));

fs.mkdirSync(path.join(out, "profiles"), { recursive: true });
profiles.forEach((p) => fs.writeFileSync(path.join(out, "profiles", p.id + ".json"), JSON.stringify(p.doc)));
const profIds = profiles.map((p) => p.id);

// batch write lists (50 per batch) with if_version for docs that already exist
// d: a JSON file {docId: version} (from the ArtifactData listing) or a dir of saved docs carrying "version"
function versions(d) {
  const v = {};
  if (d && fs.existsSync(d) && fs.statSync(d).isFile()) return JSON.parse(fs.readFileSync(d, "utf8"));
  if (d && fs.existsSync(d)) for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".json"))) {
    const j = JSON.parse(fs.readFileSync(path.join(d, f), "utf8")); v[j.id ?? path.basename(f, ".json")] = j.version;
  }
  return v;
}
const ev = versions(extDir), pv = versions(profDir);
const writes = [
  ...Object.values(games).map((g) => g.gameId).map((id) => ({ op: "set", collection: "extgames", doc_id: id, file_path: path.resolve(out, "extgames", id + ".json"), ...(ev[id] ? { if_version: ev[id] } : {}) })),
  ...profIds.map((id) => ({ op: "set", collection: "profiles", doc_id: id, file_path: path.resolve(out, "profiles", id + ".json"), ...(pv[id] ? { if_version: pv[id] } : {}) })),
];
for (let i = 0; i < writes.length; i += 50) fs.writeFileSync(path.join(out, "batch" + i / 50 + ".json"), JSON.stringify(writes.slice(i, i + 50)));
console.log("batches", Math.ceil(writes.length / 50), "writes", writes.length, "profiles", profIds.length);

const yrs = {};
Object.values(games).forEach((g) => { const y = g.date.slice(0, 4); yrs[y] = (yrs[y] || 0) + 1; });
console.log("games", Object.keys(games).length, JSON.stringify(yrs), "latest", Object.values(games).map((g) => g.date).sort().pop());
console.log("event links", links.length, links.map((l) => l.eventId + "→" + l.gameId).join(", "));
console.log("roster players not in app members", unmatchedRoster.join(", ") || "none");
