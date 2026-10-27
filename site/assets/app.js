// AD 599 class web app, static edition (GitHub Pages + Supabase).
//
// The Flask app rendered Jinja templates on the server. Here the same templates (site/templates)
// are rendered in the browser by Nunjucks, and every page's data comes from one database function,
// public.app_call(route, token, args), which runs the same logic the Flask routes ran.
//
//   URL  ->  ROUTES below  ->  app_call(route)  ->  JSON  ->  template  ->  page
//   form ->  POST route    ->  app_call(route)  ->  {_redirect, _flash}  ->  next page

import { CONFIG } from "./config.js";
import { STATS, PyDict, PyFloat } from "./stats.js";
import { parseCSV, toCSV, rosterFromCSV, w01FromCSV, ROSTER_TEMPLATE, classW02Module } from "./csv.js";

const nunjucks = window.nunjucks;
export const BASE = CONFIG.base;                       // "/ad599-app/" on GitHub Pages, "/" locally
const TOKEN_KEY = "ad599.token";

// ---- session token (per browser; signing out deletes it on the server too) ------------------------
const store = {
  get() { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return mem.token; } },
  set(v) { mem.token = v || ""; try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch {} },
};
const mem = { token: "" };

// ---- the one API call ------------------------------------------------------------------------------
export class ApiError extends Error {}

export async function call(route, args = {}) {
  const key = CONFIG.supabaseKey;
  const headers = { "Content-Type": "application/json", apikey: key };
  if (key.startsWith("eyJ")) headers.Authorization = "Bearer " + key;     // legacy anon JWT keys
  let res;
  try {
    res = await fetch(CONFIG.supabaseUrl.replace(/\/+$/, "").replace(/\/rest\/v1$/, "") + "/rest/v1/rpc/app_call", {
      method: "POST", headers,
      body: JSON.stringify({ p_route: route, p_token: store.get() || null, p_args: args }),
    });
  } catch (e) {
    throw new ApiError("network: " + e.message);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.message || `HTTP ${res.status}`);
  if ("_token" in body) store.set(body._token);
  if (body._error) throw new ApiError(body._error);
  return body;
}

// ---- routes: [method, pattern, spec] -----------------------------------------------------------------
// spec.rpc  : the app.r_<rpc> function to call      spec.tpl : template to render with its result
// spec.prep : extra context derived in the browser   spec.download : turns the result into a file
const W = (slug) => ({ w01: "w01", w02: "w02", w03: "w03", w04: "w04", w05: "w05", w06: "w06", w07: "w07" }[slug]);
const ROUTES = [
  ["GET", "/", { rpc: "home", tpl: "index.html" }],
  ["GET", "/login", { rpc: "me", tpl: "login.html", prep: (c, p, q) => ({ username: q.username || "" }) }],
  ["POST", "/login", { rpc: "login", args: (p, q) => ({ next: q.next }) }],
  ["GET", "/logout", { rpc: "logout" }],

  ["GET", "/admin/login", { rpc: "me", tpl: "admin/login.html" }],
  ["POST", "/admin/login", { rpc: "admin_login", args: (p, q) => ({ next: q.next }) }],
  ["GET", "/admin/logout", { rpc: "admin_logout" }],
  ["GET", "/admin/", { rpc: "admin_overview", tpl: "admin/overview.html" }],
  ["GET", "/admin/students", { rpc: "admin_students", tpl: "admin/students.html" }],
  ["POST", "/admin/students", { rpc: "admin_roster", form: async (f) => rosterFromCSV(await fileText(f, "roster")) }],
  ["GET", "/admin/students/template.csv", { download: () => file("ad599_roster_template.csv", "text/csv", ROSTER_TEMPLATE) }],
  ["POST", "/admin/students/delete/:sid", { rpc: "admin_delete_student" }],
  // w07 instructor pages (before the generic /admin/:slug/... routes)
  ["GET", "/admin/w07/analytics", { rpc: "admin_data", args: () => ({ slug: "w07" }), tpl: "w07/analytics.html",
    prep: (c, p, q) => ({ s: STATS.w07(c, q), mod: { TITLE: c.title } }) }],
  ["GET", "/admin/w07/control", { rpc: "admin_w07_control", tpl: "w07/control.html" }],
  ["POST", "/admin/w07/section", { rpc: "admin_w07_section" }],
  ["POST", "/admin/w07/teams", { rpc: "admin_w07_teams" }],
  ["GET", "/admin/w07/teamview", { rpc: "admin_w07_teamview", tpl: "w07/teams.html" }],
  ["GET", "/admin/w07/teams.csv", { rpc: "admin_w07_teamview", download: (c) => file("ad599_term_project_teams.csv", "text/csv",
    toCSV(c.rows.map((r) => Object.fromEntries(TEAM_COLS.map((k) => [k, r[k]]))))) }],
  ["GET", "/admin/:slug/", { rpc: "admin_submissions", tpl: "admin/submissions.html",
    prep: (c) => ({ mod: { TITLE: c.title }, columns: c.columns }) }],
  ["POST", "/admin/:slug/delete/:row_id", { rpc: "admin_delete_row" }],
  ["POST", "/admin/:slug/reset", { rpc: "admin_reset" }],
  ["POST", "/admin/:slug/seed", { rpc: "admin_seed" }],
  ["POST", "/admin/:slug/import", { rpc: "admin_import", form: async (f) => w01FromCSV(await fileText(f, "csv")) }],
  ["POST", "/admin/:slug/toggle", { rpc: "admin_toggle", args: () => ({ _back: currentPath() }) }],
  ["GET", "/admin/:slug/analytics", { rpc: "admin_data", tpl: (p) => `${W(p.slug)}/analytics.html`, prep: adminStats }],
  ["GET", "/admin/:slug/report", { rpc: "admin_data", tpl: (p) => ({ w01: "w01/report.html", w02: "w02/report.html" }[p.slug] || `${W(p.slug)}/analytics.html`), prep: adminStats }],
  ["GET", "/admin/:slug/export.csv", { rpc: "admin_export", download: (c) => file(`ad599_${c.slug}_submissions.csv`, "text/csv", toCSV(JSON.parse(c.rows_json))) }],
  ["GET", "/admin/:slug/export.json", { rpc: "admin_export", download: (c) => file(`ad599_${c.slug}_submissions.json`, "application/json", JSON.stringify(JSON.parse(c.rows_json), null, 2)) }],
  ["GET", "/admin/:slug/class_:slug2.py", { rpc: "admin_class_module", download: (c, p) => file(`class_${p.slug}.py`, "text/x-python", classW02Module(c)) }],

  ["GET", "/w01/", { rpc: "w01_form", tpl: "w01/form.html" }],
  ["POST", "/w01/submit", { rpc: "w01_submit" }],
  ["GET", "/w01/mine", { rpc: "w01_mine", tpl: "w01/mine.html" }],

  ["GET", "/w02/", { rpc: "w02_index", tpl: "w02/index.html", prep: (c) => ({ per_q: pydict(c.per_q) }) }],
  ["GET", "/w02/q/:qid", { rpc: "w02_question", tpl: "w02/question.html" }],
  ["POST", "/w02/q/:qid/note", { rpc: "w02_note" }],
  ["POST", "/w02/q/:qid/context", { rpc: "w02_context" }],
  ["POST", "/w02/q/:qid/add", { rpc: "w02_add" }],
  ["POST", "/w02/q/:qid/delete/:row_id", { rpc: "w02_delete" }],
  ["GET", "/w02/mine", { rpc: "w02_mine", tpl: "w02/mine.html", prep: (c) => {
    const by_q = {};
    for (const r of c.rows) (by_q[r.question_id] ||= []).push(r);
    return { by_q: pydict(by_q), total: c.rows.length, n_q: Object.keys(by_q).length,
             questions_with: c.questions.filter((q) => by_q[q.id]) };
  } }],

  ["GET", "/w03/", { rpc: "w03_index", tpl: "w03/tasks.html", prep: (c) => ({ mine: pydict(c.mine) }) }],
  ["POST", "/w03/answers", { rpc: "w03_answers" }],
  ["GET", "/w03/class_data.py", { rpc: "file", args: () => ({ slug: "w03", name: "class_data.py" }) }],

  ["GET", "/w04/", { rpc: "w04_index", tpl: "w04/tasks.html", prep: (c) => ({ mine: pydict(c.mine) }) }],
  ["POST", "/w04/answers", { rpc: "w04_answers" }],
  ["POST", "/w04/design", { rpc: "w04_design" }],
  ["GET", "/w04/class_data.py", { rpc: "file", args: () => ({ slug: "w04", name: "class_data.py" }) }],

  ["GET", "/w05/", { rpc: "w05_index", tpl: "w05/form.html" }],
  ["POST", "/w05/", { rpc: "w05_save" }],
  ["GET", "/w05/data/:name", { rpc: "file", args: (p) => ({ slug: "w05", name: p.name }) }],

  ["GET", "/w06/", { rpc: "w06_index", tpl: "w06/tasks.html", prep: (c) => ({
    mine: pydict(c.mine),
    part1_qs: c.s.questions.filter((q) => q.part === c.part1),
    part2_qs: c.s.questions.filter((q) => q.part === c.part2) }) }],
  ["POST", "/w06/answers", { rpc: "w06_answers" }],

  ["GET", "/w07/", { rpc: "w07_index", tpl: "w07/index.html", prep: w07Prep }],
  ["POST", "/w07/save", { rpc: "w07_save" }],
];

// w07: each item gets its saved value, and choice items get [{text, on}] so the template stays simple
function w07Prep(c) {
  const mine = c.mine || {};
  const secs = (c.sections || []).map((s) => ({
    ...s,
    n_done: s.items.filter((it) => it.id in mine).length,
    items: s.items.map((it) => {
      const v = mine[it.id] ?? "";
      let picked = [];
      if (it.type === "multi" && v) { try { picked = JSON.parse(v); } catch { picked = []; } }
      return { ...it, val: it.type === "multi" ? "" : v, ranged: it.min !== undefined && it.max !== undefined,
               opts: (it.options || []).map((o) => ({ text: o, on: it.type === "multi" ? picked.includes(o) : o === v })) };
    }),
  }));
  return { secs };
}

// column order for /admin/w07/teams.csv
const TEAM_COLS = ["team", "tier", "competence", "first_name", "last_name", "nickname", "username", "email", "program",
  "comfort_excel", "comfort_python", "comfort_sql", "commute_min", "w02_variables", "w02_structures",
  "w03_correct", "w03_answered", "w04_correct", "w04_answered", "w04_design", "w05_team_algo",
  "w06_correct", "w06_answered", "w07_answered", "w07_checks_right", "w07_checks", "on_roster"];

function adminStats(c, p) {
  const s = STATS[p.slug](c);
  return { s, rows: c.rows || [], mod: { TITLE: c.title } };
}

function compile(pattern) {
  const names = [];
  const re = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:([a-z_0-9]+)/g, (_, n) => { names.push(n); return "([^/]+)"; });
  return { re: new RegExp("^" + re + "$"), names };
}
const TABLE = ROUTES.map(([m, pat, spec]) => ({ m, pat, spec, ...compile(pat) }));

function match(method, path) {
  for (const cand of [path, path.endsWith("/") ? null : path + "/"]) {   // Flask: /w01 -> /w01/
    if (!cand) continue;
    for (const r of TABLE) {
      if (r.m !== method) continue;
      const m = r.re.exec(cand);
      if (m) return { r, path: cand, params: Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) };
    }
  }
  return null;
}

// ---- URLs -------------------------------------------------------------------------------------------
export function href(path) { return BASE.replace(/\/$/, "") + path; }
function appPath(pathname) {                      // "/ad599-app/w01/" -> "/w01/"
  const b = BASE.replace(/\/$/, "");
  return pathname.startsWith(b) ? (pathname.slice(b.length) || "/") : pathname;
}
function currentPath() { return appPath(location.pathname) + location.search; }
function query() { return Object.fromEntries(new URLSearchParams(location.search)); }

const ENDPOINTS = {
  "index": "/", "auth.login": "/login", "auth.logout": "/logout",
  "admin.overview": "/admin/", "admin.login": "/admin/login", "admin.logout": "/admin/logout",
  "admin.students": "/admin/students", "admin.delete_student": "/admin/students/delete/{sid}",
  "admin.roster_template": "/admin/students/template.csv",
  "admin.submissions": "/admin/{slug}/", "admin.delete_row": "/admin/{slug}/delete/{row_id}", "admin.reset": "/admin/{slug}/reset",
  "admin.seed": "/admin/{slug}/seed", "admin.import_rows": "/admin/{slug}/import", "admin.toggle": "/admin/{slug}/toggle",
  "admin.analytics": "/admin/{slug}/analytics", "admin.report": "/admin/{slug}/report",
  "admin.export_csv": "/admin/{slug}/export.csv", "admin.export_json": "/admin/{slug}/export.json",
  "admin.export_module": "/admin/{slug}/class_{slug2}.py",
  "week01.form": "/w01/", "week01.submit": "/w01/submit", "week01.mine": "/w01/mine",
  "week02.index": "/w02/", "week02.question": "/w02/q/{qid}", "week02.note": "/w02/q/{qid}/note",
  "week02.context": "/w02/q/{qid}/context", "week02.add": "/w02/q/{qid}/add", "week02.delete": "/w02/q/{qid}/delete/{row_id}",
  "week02.mine": "/w02/mine",
  "week03.index": "/w03/", "week03.answers": "/w03/answers", "week03.class_data": "/w03/class_data.py",
  "week04.index": "/w04/", "week04.answers": "/w04/answers", "week04.design": "/w04/design", "week04.class_data": "/w04/class_data.py",
  "week05.index": "/w05/", "week05.data": "/w05/data/{name}",
  "week06.index": "/w06/", "week06.answers": "/w06/answers",
  "week07.index": "/w07/", "week07.save": "/w07/save",
  "admin.w07_live": "/admin/w07/analytics", "admin.w07_control": "/admin/w07/control",
  "admin.w07_section": "/admin/w07/section", "admin.w07_teams": "/admin/w07/teams",
  "admin.w07_teamview": "/admin/w07/teamview", "admin.w07_teams_csv": "/admin/w07/teams.csv",
};

function url_for(endpoint, kw = {}) {
  const pat = ENDPOINTS[endpoint];
  if (!pat) throw new Error("url_for: unknown endpoint " + endpoint);
  const used = new Set();
  let path = pat.replace(/\{(\w+)\}/g, (_, k) => { used.add(k); return encodeURIComponent(kw[k]); });
  const extra = Object.entries(kw).filter(([k, v]) => !used.has(k) && k !== "__keywords" && v !== undefined && v !== null);
  if (extra.length) path += "?" + new URLSearchParams(extra.map(([k, v]) => [k, String(v)])).toString();
  return href(path);
}

// ---- Python-flavoured helpers for the templates ------------------------------------------------------
export const pydict = (o) => new PyDict(o);

export function pyTruthy(v) {
  if (v === null || v === undefined || v === false || v === 0 || v === "" || Number.isNaN(v)) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof PyFloat) return v.v !== 0;
  if (v instanceof nunjucks.runtime.SafeString) return String(v).length > 0;
  if (v instanceof PyDict || (typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype)) return Object.keys(v).length > 0;
  return true;
}

// Jinja treats empty lists and dicts as false; JavaScript does not. Teach the Nunjucks compiler.
function patchTruthiness() {
  nunjucks.runtime.pyT = pyTruthy;
  const C = nunjucks.compiler.Compiler.prototype;
  C.compileNot = function (node, frame) { this._emit("!runtime.pyT("); this.compile(node.target, frame); this._emit(")"); };
  C.compileAnd = function (node, frame) {
    this._emit("((function(__a){return runtime.pyT(__a)?("); this.compile(node.right, frame);
    this._emit("):__a;})("); this.compile(node.left, frame); this._emit("))");
  };
  C.compileOr = function (node, frame) {
    this._emit("((function(__a){return runtime.pyT(__a)?__a:("); this.compile(node.right, frame);
    this._emit(");})("); this.compile(node.left, frame); this._emit("))");
  };
  C.compileInlineIf = function (node, frame) {
    this._emit("(runtime.pyT("); this.compile(node.cond, frame); this._emit(")?");
    this.compile(node.body, frame); this._emit(":");
    if (node.else_ !== null) this.compile(node.else_, frame); else this._emit('""');
    this._emit(")");
  };
  const origIf = C.compileIf;
  C.compileIf = function (node, frame, async) {
    const orig = this._compileExpression;
    let first = true;
    this._compileExpression = function (n, f) {
      if (first && n === node.cond) { first = false; this._emit("runtime.pyT("); orig.call(this, n, f); this._emit(")"); }
      else orig.call(this, n, f);
    };
    try { origIf.call(this, node, frame, async); } finally { this._compileExpression = orig; }
  };
}

function fmtPercent(spec, v) {                    // the subset of Python %-formatting the templates use
  return spec.replace(/%(\.(\d+))?([dfs%])/g, (_, __, prec, t) => {
    if (t === "%") return "%";
    if (t === "d") return String(Math.trunc(Number(v)));
    if (t === "f") return pyRound(Number(v), prec === undefined ? 6 : Number(prec));
    return String(v);
  });
}
function pyRound(x, n) {                          // "%.Nf" with round-half-even on the exact binary value, like Python
  return x.toFixed(n);
}

function mdLike(text, blocks) {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&#34;").replace(/'/g, "&#39;");
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  if (!blocks) return new nunjucks.runtime.SafeString(inline(text ?? ""));
  const parts = String(text ?? "").split("```");
  return new nunjucks.runtime.SafeString(parts.map((p, k) => (k % 2 ? `<pre>${esc(p.replace(/^\n+|\n+$/g, ""))}</pre>` : inline(p))).join(""));
}

function makeEnv() {
  patchTruthiness();
  const loader = new (nunjucks.Loader.extend({
    getSource(name) {
      if (!(name in TEMPLATES)) throw new Error("template not loaded: " + name);
      return { src: TEMPLATES[name], path: name, noCache: false };
    },
  }))();
  const env = new nunjucks.Environment(loader, { autoescape: true });
  env.addFilter("md", (t) => mdLike(t, false));
  env.addFilter("md6", (t) => mdLike(t, false));
  env.addFilter("md4", (t) => mdLike(t, true));
  env.addFilter("tojson", (v) => new nunjucks.runtime.SafeString(
    JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/'/g, "\\u0027")));
  env.addFilter("format", (spec, ...args) => fmtPercent(spec, args[0]));
  env.addFilter("selectattr", (arr, attr, test, val) => (arr || []).filter((x) =>
    test === undefined ? pyTruthy(x?.[attr]) : test === "equalto" ? x?.[attr] === val : pyTruthy(x?.[attr])));
  env.addFilter("map", (arr, ...args) => {
    const kw = args.find((a) => a && a.__keywords) || {};
    return (arr || []).map((x) => (kw.attribute !== undefined ? x?.[kw.attribute] : x));
  });
  env.addFilter("max", (arr) => (arr && arr.length ? arr.reduce((a, b) => (b > a ? b : a)) : undefined));
  env.addGlobal("url_for", (endpoint, kw) => url_for(endpoint, kw || {}));
  env.addGlobal("get_flashed_messages", () => { const m = flashes.splice(0); return m; });
  return env;
}

// ---- templates: fetched once, with whatever they extend or include --------------------------------------
const TEMPLATES = {};
async function loadTemplate(name) {
  if (name in TEMPLATES) return;
  const res = await fetch(href("/templates/" + name) + "?v=" + CONFIG.version);
  if (!res.ok) throw new Error("missing template " + name);
  const src = await res.text();
  TEMPLATES[name] = src;
  const deps = [...src.matchAll(/\{%-?\s*(?:extends|include|import|from)\s+["']([^"']+)["']/g)].map((m) => m[1]);
  await Promise.all(deps.map(loadTemplate));
}

// ---- rendering a page ----------------------------------------------------------------------------------
const flashes = [];
let env;

async function render(tpl, ctx) {
  await loadTemplate(tpl);
  const me = ctx.me || { student: null, is_admin: false };
  const html = env.render(tpl, { course: CONFIG.course, student: me.student, is_admin: me.is_admin, ...ctx });
  const doc = new DOMParser().parseFromString(html, "text/html");
  document.querySelectorAll("head > :not([data-shell])").forEach((n) => n.remove());
  for (const n of [...doc.head.childNodes]) if (n.nodeName !== "TITLE") document.head.appendChild(document.importNode(n, true));
  document.title = doc.title;                    // after the old <title> is removed, so the tab keeps a name
  document.body.replaceWith(document.importNode(doc.body, true));
  // run the page's own <script>s (charts, copy buttons); a block keeps re-renders from clashing
  for (const old of document.querySelectorAll("script:not([data-shell])")) {
    const s = document.createElement("script");
    s.textContent = "{\n" + old.textContent + "\n}";
    old.replaceWith(s);
  }
  const id = decodeURIComponent(location.hash.slice(1));
  const target = id && document.getElementById(id);
  if (target) target.scrollIntoView(); else window.scrollTo(0, 0);
}

async function renderError(msg) {
  try {
    await render("error.html", { message: msg, me: lastMe });
  } catch {
    document.body.textContent = msg;
  }
  document.body.dataset.page = "error.html";
}

let lastMe = null;

function file(name, mime, body) { return { name, mime, body }; }
function save(f) {
  const blob = new Blob([f.body], { type: f.mime + ";charset=utf-8" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: f.name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function fileText(form, field) {
  const f = form.querySelector(`input[type=file][name="${field}"]`)?.files?.[0];
  if (!f) return "";
  return (await f.text()).replace(/^\uFEFF/, "");
}

// handle what a route returned: redirect, download, or a page
async function handle(spec, params, ctx, method, path) {
  if (ctx.me) lastMe = ctx.me;
  if (ctx._flash) flashes.push(...ctx._flash.filter(Boolean));
  if (ctx._download || spec.download) {
    save(ctx._download ? file(ctx._download.filename, ctx._download.mime, ctx._download.body) : spec.download(ctx, params));
    // opened by typing the file's URL: show the page it belongs to
    if (!document.body.dataset.page) return go(path.replace(/[^/]*$/, ""), { replace: true });
    return;
  }
  if (ctx._redirect) return go(ctx._redirect, { replace: method === "GET" });
  const tpl = ctx._template || (typeof spec.tpl === "function" ? spec.tpl(params) : spec.tpl);
  if (!tpl) return go("/", { replace: true });
  const extra = !ctx._template && spec.prep ? spec.prep(ctx, params, query()) : {};
  await render(tpl, { ...ctx, ...extra });
  document.body.dataset.page = tpl;
}

async function run(method, path, params, spec, formArgs = {}) {
  try {
    const q = query();
    const args = { ...(method === "GET" ? q : {}), ...params, ...(spec.args ? spec.args(params, q) : {}), ...formArgs };
    const ctx = spec.rpc ? await call(spec.rpc, args) : {};
    await handle(spec, params, ctx, method, path);
  } catch (e) {
    const m = String(e.message || e);
    if (m === "login_required") return go("/login?next=" + encodeURIComponent(currentPath()), { replace: true });
    if (m === "admin_required") return go("/admin/login?next=" + encodeURIComponent(currentPath()), { replace: true });
    if (m === "not_found") return renderError("Not found.");
    console.error(e);
    return renderError(m.startsWith("network") ? "Could not reach the database. Check your connection and reload." : m);
  }
}

// ---- navigation -------------------------------------------------------------------------------------------
export async function go(target, { replace = false } = {}) {
  const u = new URL(href(target.startsWith("/") ? target : "/" + target), location.origin);
  if (replace) history.replaceState(null, "", u); else history.pushState(null, "", u);
  return route();
}

async function route() {
  const path = appPath(location.pathname);
  const m = match("GET", path);
  if (!m) return renderError("Not found.");
  if (m.path !== path) history.replaceState(null, "", href(m.path) + location.search + location.hash);
  return run("GET", m.path, m.params, m.r.spec);
}

function formArgs(form) {
  const out = {};
  for (const [k, v] of new FormData(form)) {
    if (v instanceof File) continue;
    if (k in out) out[k] = [].concat(out[k], v); else out[k] = v;
  }
  for (const el of form.querySelectorAll("input[type=checkbox][name]")) if (!(el.name in out)) out[el.name] = [];
  return out;
}

function onClick(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest("a[href]");
  if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
  const u = new URL(a.href, location.href);
  if (u.origin !== location.origin || !u.pathname.startsWith(BASE.replace(/\/$/, "") || "/")) return;
  if (u.pathname === location.pathname && u.search === location.search && u.hash) return;   // in-page anchor
  e.preventDefault();
  const m = match("GET", appPath(u.pathname));
  if (m && (m.r.spec.download || m.r.spec.rpc === "file")) return run("GET", m.path, m.params, m.r.spec);   // a file: stay on this page
  go(appPath(u.pathname) + u.search + u.hash);
}

async function onSubmit(e) {
  if (e.defaultPrevented) return;
  const form = e.target;
  const u = new URL(form.getAttribute("action") || location.href, location.href);
  const method = (form.getAttribute("method") || "get").toUpperCase();
  const path = appPath(u.pathname);
  const m = match(method === "POST" ? "POST" : "GET", path);
  if (!m) return;
  e.preventDefault();
  const btns = form.querySelectorAll("button, input[type=submit]");
  btns.forEach((b) => (b.disabled = true));
  try {
    const args = m.r.spec.form ? await m.r.spec.form(form) : formArgs(form);
    if (method === "POST") await run("POST", m.path, m.params, m.r.spec, { ...Object.fromEntries(u.searchParams), ...args });
    else await go(path + "?" + new URLSearchParams(args).toString());
  } finally {
    btns.forEach((b) => (b.disabled = false));
  }
}

// ---- start ---------------------------------------------------------------------------------------------------
async function start() {
  if (!CONFIG.supabaseUrl || CONFIG.supabaseUrl.includes("YOUR-PROJECT")) {
    document.body.innerHTML = "<p style='font:16px system-ui;padding:24px'>Set supabaseUrl and supabaseKey in site/assets/config.js.</p>";
    return;
  }
  env = makeEnv();
  // deep links like /w02/q/5 arrive through 404.html, which is this same page
  document.addEventListener("click", onClick);
  document.addEventListener("submit", onSubmit);
  window.addEventListener("popstate", route);
  await route();
}

start();
