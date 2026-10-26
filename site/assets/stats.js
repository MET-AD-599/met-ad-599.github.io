// compute_stats() from each lecture module, ported from Python so the instructor pages can run
// on GitHub Pages. Inputs are the rows the database returns (app.admin_data_<slug>()).

// ---- Python behaviour we rely on ----------------------------------------------------------------------
// round(x, n) with round-half-even on the exact binary value
export function pyRound(x, n = 0) {
  if (!Number.isFinite(x)) return x;
  const exact = Math.abs(x).toFixed(60).replace(/0+$/, "");
  const [ip, fp = ""] = exact.split(".");
  let digits = (ip + fp.padEnd(n, "0").slice(0, n)).split("").map(Number);
  const rest = fp.slice(n);
  const half = rest[0] > "5" || (rest[0] === "5" && /[1-9]/.test(rest.slice(1)));
  const tie = rest[0] === "5" && !/[1-9]/.test(rest.slice(1));
  if (half || (tie && digits[digits.length - 1] % 2 === 1)) {
    let k = digits.length - 1;
    while (k >= 0 && digits[k] === 9) { digits[k] = 0; k--; }
    if (k < 0) digits.unshift(1); else digits[k] += 1;
  }
  const s = digits.join("");
  const v = Number(n ? s.slice(0, s.length - n) + "." + s.slice(s.length - n) : s);
  return x < 0 ? -v : v;
}

// a float that prints the way Python prints it ("25.0", not "25"), but behaves as a number
export class PyFloat {
  constructor(v) { this.v = v; }
  valueOf() { return this.v; }
  toJSON() { return this.v; }
  toString() {
    const v = this.v;
    if (Number.isNaN(v)) return "nan";
    if (!Number.isFinite(v)) return v > 0 ? "inf" : "-inf";
    if (Number.isInteger(v) && Math.abs(v) < 1e16) return v.toFixed(1);
    return String(v);
  }
}
const F = (v) => new PyFloat(v);

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => sum(xs) / xs.length;
function median(xs) {                                 // statistics.median: int for odd n, float for even n
  const s = [...xs].sort((a, b) => a - b), n = s.length, m = Math.floor(n / 2);
  return n % 2 ? s[m] : F((s[m - 1] + s[m]) / 2);
}
// collections.Counter(...).most_common(k): count desc, ties in first-seen order
function counter(items) {
  const m = new Map();
  for (const x of items) m.set(x, (m.get(x) || 0) + 1);
  return m;
}
function mostCommon(m, k) {
  const arr = [...m.entries()].map((e, i) => [e, i]).sort((a, b) => b[0][1] - a[0][1] || a[1] - b[1]).map((x) => x[0]);
  return k === undefined ? arr : arr.slice(0, k);
}
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const label = (r) => r.nickname || r.first_name;

export class PyDict {
  constructor(obj) { Object.assign(this, obj || {}); }
  get(k, d = null) {
    if (Object.prototype.hasOwnProperty.call(this, String(k))) return this[String(k)];
    return d && typeof d === "object" && Object.getPrototypeOf(d) === Object.prototype ? new PyDict(d) : d;   // `.get(k, {})` stays a dict
  }
  items() { return Object.entries(this); }
  keys() { return Object.keys(this); }
  values() { return Object.values(this); }
}

// ---- w01 ----------------------------------------------------------------------------------------------------
function fitLine(xs, ys) {
  if (xs.length < 3) return null;
  const mx = mean(xs), my = mean(ys);
  const sxx = sum(xs.map((x) => (x - mx) ** 2));
  if (sxx === 0) return null;
  const slope = sum(xs.map((x, i) => (x - mx) * (ys[i] - my))) / sxx;
  return [slope, my - slope * mx];
}

function w01(d) {
  const rows = d.rows, n = rows.length;
  if (n === 0) return { n: 0 };
  const commute = rows.map((r) => r.commute_min), excel = rows.map((r) => r.comfort_excel), sql = rows.map((r) => r.comfort_sql);
  const labels = rows.map(label);
  const emails = rows.map((r) => r.bu_email).filter(Boolean);
  const modes = d.modes || ["Walk", "T / bus", "Drive", "Bike"];
  const mc = {};
  for (const r of rows) mc[r.commute_mode] = (mc[r.commute_mode] || 0) + 1;
  const tools = { Excel: "comfort_excel", Python: "comfort_python", SQL: "comfort_sql" };
  const comfort_means = {}, comfort_dist = {};
  for (const [t, col] of Object.entries(tools)) {
    comfort_means[t] = F(pyRound(mean(rows.map((r) => r[col])), 2));
    comfort_dist[t] = [1, 2, 3, 4, 5].map((i) => rows.filter((r) => r[col] === i).length);
  }
  let longest = rows[0];
  for (const r of rows) if (r.commute_min > longest.commute_min) longest = r;
  return {
    n,
    commute_stats: { total: sum(commute), mean: F(pyRound(mean(commute), 1)), median: median(commute) },
    emails: { given: emails.length, bu: emails.filter((e) => e.trim().toLowerCase().endsWith("@bu.edu")).length, samples: emails.slice(0, 8) },
    labels: labels.slice(0, 40),
    mode_counts: new PyDict(Object.fromEntries(modes.map((m) => [m, mc[m] || 0]))),
    commute: { max: Math.max(...commute), longest: label(longest) },
    comfort_means: new PyDict(comfort_means),
    comfort_dist: new PyDict(comfort_dist),
    scatter: { x: excel, y: sql, text: labels },
    line: fitLine(excel, sql),
    sql_program: d.sql_program,
    program_rows: d.program_rows,
    sql_window: d.sql_window,
    timeline: d.timeline,
    questions: rows.map((r) => r.business_q).filter(Boolean).slice(-30),
  };
}

// ---- w02 ----------------------------------------------------------------------------------------------------
function w02(d) {
  const rows = d.rows, n = rows.length, c = d.c, ROLES = c.roles;
  const who = (r) => (r.student_id ?? r.nickname);
  const students = new Set(rows.map(who));
  const notes = d.notes.map((m) => ({ ...m, reason_list: (m.reasons || "").split(",").filter(Boolean) }));
  const lab = Object.fromEntries([...c.reasons, ...c.verdicts, ...c.scales, ...c.excel_tools].map((x) => [x[0], x[1]]));
  const py_of = Object.fromEntries(c.excel_tools.map((x) => [x[0], x[2]]));
  const qs = [...d.questions].sort((a, b) => (Number(!a.featured) - Number(!b.featured)) || a.id - b.id);
  const per_q = qs.map((q) => {
    const qrows = rows.filter((r) => r.question_id === q.id);
    const qn = notes.filter((m) => m.question_id === q.id);
    const vc = counter(qn.filter((m) => m.verdict).map((m) => m.verdict));
    const tot = sum([...vc.values()]);
    const st = {
      q, n: qrows.length, students: new Set(qrows.map(who)).size,
      why_python: qn.filter((m) => m.excel_break).map((m) => [m.nickname, m.excel_break]),
      contexts: qn.filter((m) => m.context).map((m) => [m.nickname, m.context]),
      n_notes: qn.length,
      verdicts: c.verdicts.map(([v]) => [lab[v], vc.get(v) || 0]),
      python_share: vc.size ? pyRound(100 * ((vc.get("python") || 0) + 0.5 * (vc.get("either") || 0)) / tot) : null,
      split: vc.size > 1 ? Math.min(...vc.values()) / Math.max(...vc.values()) : 0,
      top_reasons: mostCommon(counter(qn.flatMap((m) => m.reason_list)), 3).map(([k, v]) => [lab[k], v]),
      excel_tools: mostCommon(counter(qn.filter((m) => m.excel_tool).map((m) => m.excel_tool))).map(([k, v]) => [lab[k], py_of[k], v]),
    };
    for (const role of ROLES) {
      const rr = qrows.filter((r) => r.role === role);
      const examples = new Map();
      for (const r of rr) {
        const key = r.var_name.trim().toLowerCase() + "\u0000" + r.dtype;
        if (r.example && !examples.has(key)) examples.set(key, [r.var_name.trim().toLowerCase(), r.dtype, r.example]);
      }
      st[role] = {
        n: rr.length,
        dtypes: mostCommon(counter(rr.map((r) => r.dtype))),
        names: mostCommon(counter(rr.map((r) => r.var_name.trim().toLowerCase())), 8),
        examples: [...examples.values()].slice(0, 12),
      };
    }
    return st;
  });
  const coverage = [...per_q].sort((a, b) => b.n - a.n);
  const ro = counter(rows.map((r) => r.role));
  return {
    n, n_students: students.size, per_q,
    dtype_overall: mostCommon(counter(rows.map((r) => r.dtype))),
    role_overall: Object.fromEntries(ROLES.map((r) => [r, ro.get(r) || 0])),
    most_tagged: coverage.slice(0, 5),
    least_tagged: coverage.slice(-5).reverse(),
    vars_per_student: students.size ? F(pyRound(n / students.size, 1)) : 0,
    n_notes: notes.length,
    verdict_overall: c.verdicts.map(([v]) => [lab[v], notes.filter((m) => m.verdict === v).length]),
    reasons_overall: mostCommon(counter(notes.flatMap((m) => m.reason_list))).map(([k, v]) => [lab[k], v]),
    scale_overall: c.scales.map(([k]) => [lab[k], notes.filter((m) => m.rows_scale === k).length]),
    tools_overall: mostCommon(counter(notes.filter((m) => m.excel_tool).map((m) => m.excel_tool))).map(([k, v]) => [lab[k], py_of[k], v]),
    most_split: per_q.filter((s) => s.n_notes >= 2).sort((a, b) => b.split - a.split).slice(0, 5),
  };
}

// ---- shared by w03, w04, w06 ----------------------------------------------------------------------------------
function taskCommon(d) {
  const progress = d.progress, ans = d.answers;
  const per_student = {};
  for (const a of ans) (per_student[a.student_id] ||= new PyDict())[a.q_no] = a;
  return {
    progress, ans,
    per_student: new PyDict(per_student),
    n_students: progress.length,
    n_answering: new Set(ans.filter((a) => a.answer).map((a) => a.student_id)).size,
    n_answers: ans.filter((a) => a.answer).length,
    n_correct: sum(ans.map((a) => a.correct)),
    n_unique: new Set(progress.map((p) => p.signature)).size,
  };
}

function slips(aa) {
  return {
    n: aa.length,
    correct: sum(aa.map((a) => a.correct)),
    mistakes: mostCommon(counter(aa.filter((a) => !a.correct && a.mistake).map((a) => a.mistake))),
    other: aa.filter((a) => !a.correct && !a.mistake).length,
  };
}

function w03(d) {
  const t = taskCommon(d);
  const by_skill = d.skills.map((sk, k) => ({ q_no: k + 1, skill: sk, ...slips(t.ans.filter((a) => a.q_no === k + 1 && a.answer)) }));
  return { ...t, by_skill, details: d.details, n_q: d.skills.length };
}

function w04(d) {
  const t = taskCommon(d);
  const anyDetails = Object.values(d.details)[0] || [];
  const n_q = anyDetails.length || d.blocks.length;
  const by_q = [];
  for (let i = 1; i <= n_q; i++) {
    const block = anyDetails[i - 1]?.block ?? i;
    by_q.push({ q_no: i, block, skill: d.blocks[block - 1], ...slips(t.ans.filter((a) => a.q_no === i && a.answer)) });
  }
  return { ...t, by_q, details: d.details, n_q, blocks: d.blocks, n_open: d.n_open, designs: d.designs,
           n_designs_done: d.designs.filter((x) => !x.need.length).length };
}

function w05(d) {
  const teams = new Map();
  for (const r of d.rows) {
    const k = r.team || "(no team)";
    if (!teams.has(k)) teams.set(k, []);
    teams.get(k).push(r);
  }
  const key = (t) => (/^\d+$/.test(t) ? [0, Number(t), ""] : [1, 0, t.toLowerCase()]);
  const ordered = [...teams.entries()].sort((a, b) => {
    const x = key(a[0]), y = key(b[0]);
    return x[0] - y[0] || x[1] - y[1] || cmp(x[2], y[2]);
  });
  return {
    n_students: d.rows.length,
    n_teams: [...teams.keys()].filter((t) => t !== "(no team)").length,
    n_complete: d.rows.filter((r) => r.inputs && r.steps && r.improve).length,
    teams: ordered,
  };
}

function w06(d) {
  const t = taskCommon(d);
  const sets = {};
  for (const p of t.progress) {
    const meta = d.meta[p.student_id] || {};
    sets[p.student_id] = { ...meta, business: meta.business || { name: "" }, questions: d.details[p.student_id] || [] };
  }
  const by_type = new Map();
  for (const a of t.ans) {
    if (!a.answer || !(a.student_id in sets)) continue;
    const q = sets[a.student_id].questions[a.q_no - 1];
    if (!q) continue;
    const title = a.q_no <= 5 ? q.title : "NumPy · " + [...q.prompt.replace(/\*\*[^*]+\*\*/g, "…")].slice(0, 70).join("");
    if (!by_type.has(title)) by_type.set(title, { n: 0, correct: 0, mistakes: new Map(), other: 0, part: "" });
    const b = by_type.get(title);
    b.part = q.part; b.n += 1; b.correct += a.correct;
    if (!a.correct) {
      if (a.mistake) b.mistakes.set(a.mistake, (b.mistakes.get(a.mistake) || 0) + 1); else b.other += 1;
    }
  }
  const types = [...by_type.entries()].map(([title, v]) => ({ title, ...v, mistakes: mostCommon(v.mistakes) }))
    .sort((a, b) => cmp(a.part, b.part) || cmp(a.title, b.title));
  const n_q = Math.max(0, ...Object.values(sets).map((s) => s.questions.length)) || 7;
  return { ...t, types, sets, n_q, n_code: t.ans.filter((a) => a.q_no > 5 && a.code).length };
}


// ---- w07 · live checkpoint results (no names) -----------------------------------------------------------------
function w07Item(it, rows, key) {
  const n = rows.length;
  const out = { ...it, n, key: key ?? null };
  if (it.type === "single" || it.type === "multi") {
    const counts = new Map(it.options.map((o) => [o, 0]));
    for (const r of rows) {
      const picked = it.type === "multi" ? (() => { try { return JSON.parse(r.answer); } catch { return []; } })() : [r.answer];
      for (const p of picked) if (counts.has(p)) counts.set(p, counts.get(p) + 1);
    }
    const top = Math.max(1, ...counts.values());
    out.bars = [...counts.entries()].map(([label, c]) => ({
      label, n: c, w: Math.round((100 * c) / top), pct: n ? Math.round((100 * c) / n) : 0, is_key: key != null && label === key }));
    if (key != null) {
      out.n_right = rows.filter((r) => r.answer === key).length;
      out.pct_right = n ? Math.round((100 * out.n_right) / n) : 0;
    }
  } else if (it.type === "number") {
    const xs = rows.map((r) => Number(r.answer)).filter((x) => Number.isFinite(x));
    out.n = xs.length;
    if (xs.length) {
      const sorted = [...xs].sort((a, b) => a - b), m = Math.floor(sorted.length / 2);
      out.median = sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
      out.mean = Math.round((10 * sum(xs)) / xs.length) / 10;
      out.vmin = sorted[0]; out.vmax = sorted[sorted.length - 1];
      const lo = Math.floor(it.min ?? out.vmin), hi = Math.ceil(it.max ?? out.vmax);
      const width = hi - lo + 1 <= 21 ? 1 : Math.ceil((hi - lo + 1) / 10);
      const bins = [];
      for (let b = lo; b <= hi; b += width) bins.push({ from: b, to: Math.min(hi, b + width - 1), n: 0 });
      for (const x of xs) {
        const k = Math.min(bins.length - 1, Math.max(0, Math.floor((x - lo) / width)));
        bins[k].n += 1;
      }
      const top = Math.max(1, ...bins.map((b) => b.n));
      out.bins = bins.map((b) => ({ ...b, h: Math.round((100 * b.n) / top), label: b.from === b.to ? String(b.from) : `${b.from}-${b.to}` }));
    }
  } else {
    out.texts = rows.map((r) => r.answer);
  }
  return out;
}

function w07(d, q = {}) {
  const key = d.key || {}, opened = d.opened || [], secsAll = d.content.sections;
  const by = new Map();
  for (const a of d.answers) { if (!by.has(a.item_id)) by.set(a.item_id, []); by.get(a.item_id).push(a); }
  const only = q.only || "";
  const items = d.opened_items || [];                              // released questions
  const isOn = (it) => q.all || only ? true : items.includes(it.id);
  const sections = secsAll.map((s) => ({ id: s.id, title: s.title,
    items: s.items.filter((it) => (!only || it.id === only) && isOn(it)).map((it) => w07Item(it, by.get(it.id) || [], key[it.id])) }))
    .filter((s) => s.items.length).reverse();                     // newest section first: that is what we are discussing
  const allItems = secsAll.flatMap((s) => s.items.map((it) => ({ id: it.id, prompt: it.prompt })));
  const nextItem = allItems.find((it) => !items.includes(it.id));
  const next = nextItem ? { id: nextItem.id, title: nextItem.prompt.length > 60 ? nextItem.prompt.slice(0, 57) + "..." : nextItem.prompt } : null;
  return {
    sections, only, next: next ? { id: next.id, title: next.title } : null,
    n_students: new Set(d.answers.filter((a) => a.student_id > 0).map((a) => a.student_id)).size,
    n_rehearsal: new Set(d.answers.filter((a) => a.student_id < 0).map((a) => a.student_id)).size,
    n_answers: d.answers.length, n_roster: d.n_roster, n_teams: d.n_teams, released: d.released,
    opened, n_sections: secsAll.length, n_items_open: items.length, n_items: allItems.length,
  };
}

export const STATS = { w01, w02, w03, w04, w05, w06, w07 };
