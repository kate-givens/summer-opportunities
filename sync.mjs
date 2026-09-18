// Pulls the Notion database and writes programs.json in the shape index.html expects.
// Usage: NOTION_TOKEN=secret_xxx node sync.mjs   (Node 18+, no dependencies)
import { writeFileSync } from "node:fs";

const DATABASE_ID = "3c8ee64ac85080bbb4bad6dfbae1b380";

// Page key -> Notion property name(s). A list means "first one that has a value".
const FIELDS = {
  title: "Name",
  summary: "Summary",
  location: "Location",
  category: "Categories",
  format: "Format",
  eligibility: "Eligibility",
  dueDate: "Summer 2027 Due Date",
  website: "Website",
  region: "Region",
};
const FLAGS_PROPERTY = "Flags";
// Entries whose Flags contain any of these (case-insensitive) are dropped entirely.
const EXCLUDE_FLAGS = ["no longer offered", "dead url", "url redirects"];
const EMPTY_DUE_DATE = "Not yet updated";
const LIST_KEYS = new Set(["category", "format", "region"]);

const token = process.env.NOTION_TOKEN;
if (!token) throw new Error("Set NOTION_TOKEN");

const headers = {
  Authorization: `Bearer ${token}`,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json",
};

const text = (arr = []) => arr.map((t) => t.plain_text).join("").trim();

function value(prop) {
  if (!prop) return "";
  switch (prop.type) {
    case "title": return text(prop.title);
    case "rich_text": return text(prop.rich_text);
    case "select": return prop.select?.name ?? "";
    case "multi_select": return prop.multi_select.map((o) => o.name);
    case "status": return prop.status?.name ?? "";
    case "date": return prop.date?.start ?? "";
    case "url": return prop.url ?? "";
    case "email": return prop.email ?? "";
    case "phone_number": return prop.phone_number ?? "";
    case "number": return prop.number == null ? "" : String(prop.number);
    case "formula": return prop.formula[prop.formula.type] ?? "";
    default: return "";
  }
}

async function fetchAllPages() {
  const pages = [];
  let cursor;
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
      method: "POST",
      headers,
      body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
    });
    if (!res.ok) throw new Error(`Notion ${res.status}: ${await res.text()}`);
    const data = await res.json();
    pages.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return pages;
}

const pages = await fetchAllPages();
if (pages[0]) {
  const missing = [...Object.values(FIELDS).flat(), FLAGS_PROPERTY].filter((n) => !(n in pages[0].properties));
  if (missing.length) console.warn("Properties not found in Notion:", missing.join(", "),
    "\nAvailable:", Object.keys(pages[0].properties).join(", "));
}

const isExcluded = (page) => {
  const flags = [].concat(value(page.properties[FLAGS_PROPERTY]) || []).join(" | ").toLowerCase();
  return EXCLUDE_FLAGS.some((f) => flags.includes(f));
};

const included = pages.filter((page) => !isExcluded(page));
console.log(`Excluded ${pages.length - included.length} flagged entries`);

const programs = included
  .map((page) => {
    const p = {};
    for (const [key, names] of Object.entries(FIELDS)) {
      let v = "";
      for (const name of [].concat(names)) {
        v = value(page.properties[name]);
        if (v && v.length) break;
      }
      if (LIST_KEYS.has(key)) {
        v = Array.isArray(v) ? v : String(v).split(/[,;]/).map((s) => s.trim()).filter(Boolean);
      } else if (Array.isArray(v)) {
        v = v.join(", ");
      }
      if (key === "dueDate" && !v) v = EMPTY_DUE_DATE;
      p[key] = v;
    }
    return p;
  })
  .filter((p) => p.title);

if (programs.length === 0) throw new Error("No programs found; refusing to overwrite programs.json");
writeFileSync("programs.json", JSON.stringify(programs, null, 2));
console.log(`Wrote ${programs.length} programs`);
