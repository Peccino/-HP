// Peccino portal dataset → team app docs. Shared by the app (admin「ポータルから取り込み」) and tools/sync-portal.js.
// convert(data, members) → { games: { <portal game_id>: extgames doc }, profiles: [{ id, doc }], unmatchedRoster: [names] }
(function (root) {
  const DATASET_RE = /<script type="application\/json" id="dataset-json">([\s\S]*?)<\/script>/;
  function parseHtml(html) {
    const m = String(html).match(DATASET_RE);
    if (!m) throw new Error("dataset-json not found: the portal page format changed");
    return JSON.parse(m[1]);
  }
  const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();
  const int = (v) => Number.isFinite(+v) ? Math.round(+v) : 0;
  const DEC = { "勝": "W", "負": "L", "S": "S", "H": "H" };
  // W/L/D always comes from the result field (it disagrees with the score in a few special-rule games).
  // Games with no result (紅白戦, 助っ人 practice) keep their stat lines but get no team result.
  const OUTCOME = { "勝ち": "W", "負け": "L", "引分け": "D" };
  // db doc ids allow only [A-Za-z0-9_-.~:@+]; portal ids like "sub_2026-09-12_ビギナーズ" get a stable hashed id
  const fnv = (str) => { let h = 0x811c9dc5; for (const c of new TextEncoder().encode(str)) { h ^= c; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); };
  const docId = (g) => /^[A-Za-z0-9_\-.~:@+]{1,200}$/.test(g.game_id) ? g.game_id : `p-${g.date_sort}-${fnv(g.game_id)}`;

  function convert(data, members) {
    const byName = new Map(members.map((x) => [norm(x.name), x.id]));
    const unmatchedRoster = new Set();
    function keyFor(log) {
      const id = byName.get(norm(log.name));
      if (id) return id;
      if (log.is_roster_member) unmatchedRoster.add(log.name);
      return "g:" + (String(log.name || "").trim() || "助っ人");
    }
    // The portal's score_for/score_against are NOT reliably ours/theirs (they look like batting-order sides).
    // Our side = the one equal to the sum of our players' runs; if that is ambiguous, the side the 勝ち/負け field implies.
    const teamRuns = {};
    data.batting_logs.forEach((b) => (teamRuns[b.game_id] = (teamRuns[b.game_id] || 0) + int(b.r)));
    function orient(g) {
      const a = int(g.score_for), b = int(g.score_against), r = teamRuns[g.game_id];
      if (r === a && r !== b) return [a, b];
      if (r === b && r !== a) return [b, a];
      if (g.result === "勝ち") return [Math.max(a, b), Math.min(a, b)];
      if (g.result === "負け") return [Math.min(a, b), Math.max(a, b)];
      return [a, b];
    }
    const games = {};
    for (const g of data.games) {
      const o = OUTCOME[g.result];
      const [us, them] = o && g.score_for != null && g.score_against != null ? orient(g) : [null, null];
      games[g.game_id] = {
        gameId: docId(g), portalId: g.game_id, date: g.date_sort, kind: g.category || "その他", opponent: g.opponent || "", place: g.place || "",
        result: o ? { us, them, o } : null, lines: {}, source: "peccino-portal",
      };
    }
    for (const b of data.batting_logs) {
      const g = games[b.game_id]; if (!g) continue;
      const k = keyFor(b), l = (g.lines[k] ||= {});
      const add = (f, v) => (l[f] = (l[f] || 0) + int(v));
      add("ab", b.ab); add("h", b.h); add("d2", b.double); add("d3", b.triple); add("hr", b.hr); add("rbi", b.rbi); add("r", b.r);
      if (l.ord == null) { l.ord = int(b.order) || 99; l.pos = b.position || ""; l.start = b.started === "先発"; }
      add("bb", int(b.bb) + int(b.hbp)); add("so", b.so); add("sb", b.sb); add("sh", b.sac); add("sf", b.sf);
    }
    for (const p of data.pitching_logs) {
      const g = games[p.game_id]; if (!g) continue;
      const k = keyFor(p), l = (g.lines[k] ||= {});
      const add = (f, v) => (l[f] = (l[f] || 0) + int(v));
      add("outs", Math.round((+p.innings || 0) * 3)); add("ph", p.h); add("er", p.er); add("pbb", int(p.bb) + int(p.hbp)); add("pso", p.so);
      l.pg = 1; if (l.pord == null) l.pord = int(p.order) || 9; // one appearance per game, even with 0 outs recorded
      if (DEC[p.decision]) l.dec = DEC[p.decision];
    }
    // player profiles (+ the portal's advanced 2026 detail) keyed by app member id
    const profiles = [];
    for (const p of data.players) {
      const id = byName.get(norm(p.name)); if (!id) continue;
      const det = data.detail_2026?.[p.name] || null;
      profiles.push({ id, doc: {
        position: p.position || "", subPosition: p.sub_position || "", throwBat: p.throw_bat || "", roleJoin: p.role_and_join_year || "",
        career: p.career && p.career !== "-" ? p.career : "", pr: p.pr || "", detailYear: det ? "2026" : "", detail: det, source: "peccino-portal",
      } });
    }
    return { games, profiles, unmatchedRoster: [...unmatchedRoster] };
  }

  // jsonb does not keep key order, so compare docs with sorted keys
  const canon = (v) => Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
  const sameDoc = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

  const api = { parseHtml, convert, sameDoc, norm, PORTAL_URL: "https://daichitanimoto.github.io/peccino-portal/" };
  if (typeof module === "object" && module.exports) module.exports = api; else root.PortalConvert = api;
})(typeof window !== "undefined" ? window : globalThis);
