// CSV in and out, done in the browser (the Flask app did this in Python on the server).

// RFC 4180 reader -> array of rows (arrays of strings); blank lines are skipped like csv.DictReader
export function parseCSV(text) {
  const rows = [];
  let row = [], field = "", i = 0, q = false, any = false;
  const s = String(text).replace(/^﻿/, "");
  while (i < s.length) {
    const ch = s[i];
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { q = true; any = true; i++; continue; }
    if (ch === ",") { row.push(field); field = ""; any = true; i++; continue; }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      if (any || row.some((f) => f !== "")) rows.push(row);
      row = []; field = ""; any = false; i++; continue;
    }
    field += ch; any = true; i++;
  }
  if (field !== "" || row.length || any) { row.push(field); if (row.some((f) => f !== "") || any) rows.push(row); }
  return rows;
}

// csv.DictReader: header row + dicts; short rows get null, extra fields are dropped
export function dictReader(text) {
  const rows = parseCSV(text);
  if (!rows.length) return { fieldnames: null, records: [] };
  const fieldnames = rows[0];
  const records = rows.slice(1).map((r) => Object.fromEntries(fieldnames.map((f, k) => [f, k < r.length ? r[k] : null])));
  return { fieldnames, records };
}

// csv.DictWriter (QUOTE_MINIMAL, \r\n) for export.csv
export function toCSV(rows) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const cell = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols, ...rows.map((r) => cols.map((c) => r[c]))].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

const pyList = (xs) => "[" + xs.map((x) => `'${x}'`).join(", ") + "]";
const normalizeUsername = (raw) => { const u = (raw || "").trim().toLowerCase(); return u.includes("@") ? u.split("@")[0] : u; };

// auth.parse_roster_csv
const CSV_REQUIRED = ["username", "password"];
const CSV_OPTIONAL = ["first_name", "last_name", "nickname", "program", "is_admin"];
const CSV_ALIASES = { bu_email: "username", email: "username", "bu email": "username", first: "first_name", last: "last_name",
  firstname: "first_name", lastname: "last_name", admin: "is_admin", superuser: "is_admin", role: "is_admin" };
const TRUTHY = new Set(["1", "true", "yes", "y", "admin", "superuser", "instructor"]);

export function rosterFromCSV(text) {
  const { fieldnames, records } = dictReader(text);
  const out = (rows, problems) => ({ rows, problems, n_problems: problems.length });
  if (!fieldnames) return out([], ["Empty file."]);
  const fields = {};
  for (const name of fieldnames) { const key = (name || "").trim().toLowerCase(); fields[name] = CSV_ALIASES[key] || key; }
  const vals = Object.values(fields);
  const missing = CSV_REQUIRED.filter((c) => !vals.includes(c));
  if (missing.length) return out([], [`Missing column(s): ${missing.join(", ")}. Header seen: ${pyList(fieldnames)}`]);
  const rows = [], problems = [], seen = new Set();
  records.forEach((raw, k) => {
    const i = k + 2;
    const r = {};
    for (const [key, v] of Object.entries(raw)) if (key in fields) r[fields[key]] = (v || "").trim();
    const username = normalizeUsername(r.username || "");
    if (!username) { problems.push(`Line ${i}: no username`); return; }
    if (seen.has(username)) { problems.push(`Line ${i}: duplicate username ${username}`); return; }
    if (!r.password) { problems.push(`Line ${i} (${username}): no password`); return; }
    seen.add(username);
    const row = { username, password: r.password };
    for (const c of CSV_OPTIONAL) row[c] = (r[c] || "").slice(0, 60);
    row.is_admin = TRUTHY.has(row.is_admin.trim().toLowerCase()) ? 1 : 0;
    rows.push(row);
  });
  return out(rows, problems);
}

// week01.import_csv (parsing half; linking to students happens in the database)
const W01_COLS = ["first_name", "last_name", "nickname", "bu_email", "commute_mode", "commute_min",
  "comfort_excel", "comfort_python", "comfort_sql", "program", "business_q"];

export function w01FromCSV(text) {
  const { fieldnames, records } = dictReader(text);
  const have = {};
  for (const c of fieldnames || []) have[(c || "").trim().toLowerCase()] = c;
  const missing = W01_COLS.filter((c) => !(c in have));
  if (missing.length) return { rows: [], problems: [`Missing column(s): ${missing.join(", ")}`] };
  const rows = records.map((raw, k) => {
    const r = { _line: k + 2 };
    for (const c of W01_COLS) r[c] = (raw[have[c]] || "").trim();
    r.submitted_at = "submitted_at" in have ? (raw[have.submitted_at] || "") : "";
    return r;
  });
  return { rows, problems: [] };
}

export const ROSTER_TEMPLATE = "username,password,first_name,last_name,nickname,program,is_admin\ntgray@bu.edu,pick-a-word,Thomas,Gray,,Appl Business Analytics MS,0\n";

// ---- week02.export_module: the class's answers as a Python module -------------------------------------
function pyStr(s) {
  s = String(s);
  const quote = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === "\\") out += "\\\\";
    else if (ch === quote) out += "\\" + ch;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (c < 32 || c === 127) out += "\\x" + c.toString(16).padStart(2, "0");
    else out += ch;
  }
  return quote + out + quote;
}
function pyRepr(v) {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return pyStr(v);
  if (Array.isArray(v)) return "[" + v.map(pyRepr).join(", ") + "]";
  return "{" + Object.entries(v).map(([k, x]) => pyStr(k) + ": " + pyRepr(x)).join(", ") + "}";
}
// pprint.pformat(obj, width=110, sort_dicts=False), close enough to read and always valid Python
function pformat(v, indent = 0, width = 110) {
  const flat = pyRepr(v);
  if (indent + flat.length <= width || (typeof v !== "object" || v === null)) return flat;
  const pad = " ".repeat(indent + 1);
  if (Array.isArray(v)) return "[" + v.map((x, i) => (i ? pad : "") + pformat(x, indent + 1, width)).join(",\n") + "]";
  return "{" + Object.entries(v).map(([k, x], i) => {
    const head = (i ? pad : "") + pyStr(k) + ": ";
    return head + pformat(x, indent + 1 + pyStr(k).length + 2, width);
  }).join(",\n") + "}";
}

export function classW02Module(c) {
  const short = Object.fromEntries((c.questions || []).map((q) => [q.id, q.short]));
  const answers = c.notes.map((m) => ({
    question_id: m.question_id, question: short[m.question_id] ?? "", context: m.context, verdict: m.verdict,
    reasons: (m.reasons || "").split(",").filter(Boolean), rows_per_year: m.rows_scale, excel_tool: m.excel_tool, comments: m.excel_break,
  }));
  const variables = c.variables.map((r) => ({ question_id: r.question_id, role: r.role, name: r.var_name, type: r.dtype, example: r.example }));
  return '"""Week 2 · the class\'s own answers, as a list of dictionaries (anonymous).\n\n'
    + '    from class_w02 import answers, variables\n"""\n\n'
    + `answers = ${pformat(answers)}\n\n`
    + `variables = ${pformat(variables)}\n`;
}
