export function fail(message: string, status = 400): never { throw Object.assign(new Error(message), {status}); }
export function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
export const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export function isoDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail("Expected a valid YYYY-MM-DD date");
  return value;
}
export function publicationDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) { try { return isoDate(value); } catch { return null; } }
  const match = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{4})$/.exec(value);
  if (!match) return null;
  const month = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ").indexOf(match[1]) + 1;
  try { return isoDate(`${match[3]}-${String(month).padStart(2, "0")}-${match[2].padStart(2, "0")}`); } catch { return null; }
}
export function positiveInteger(value: unknown, fallback: number, max: number, label: string): number {
  const result = value ?? fallback;
  if (!["string", "number"].includes(typeof result) || !/^\d+$/.test(String(result)) || Number(result) < 1 || Number(result) > max) fail(`Invalid ${label}`);
  return Number(result);
}
export function sha256(bytes: Uint8Array): Promise<string> {
  return crypto.subtle.digest("SHA-256", bytes as BufferSource).then(hash => Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join(""));
}

// Extract direct document identity fields with namespace and nesting checks.
// This is not full SPL schema validation or clinical section interpretation.
export function splIdentity(xml: string) {
  const stack: {name: string; ns: Record<string, string>}[] = [];
  const fields: Record<string, string> = {};
  let rootSeen = false; let end = 0; let nodes = 0;
  const tokens = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<(?:[^<>"']|"[^"]*"|'[^']*')+>/g;
  for (const match of xml.matchAll(tokens)) {
    const between = xml.slice(end, match.index);
    if (between.includes("<") || (!stack.length && between.trim())) fail("Malformed SPL XML", 502);
    end = match.index + match[0].length;
    const token = match[0];
    if (token.startsWith("<!--") || token.startsWith("<?")) continue;
    if (token.startsWith("<![CDATA[")) { if (!stack.length) fail("CDATA outside SPL document", 502); continue; }
    if (token.startsWith("<!")) fail("DTD/declarations are not supported in SPL XML", 502);
    const closing = /^<\/([\w:.-]+)\s*>$/.exec(token);
    if (closing) { if (stack.pop()?.name !== closing[1]) fail("Unbalanced SPL XML", 502); continue; }
    const opening = /^<([\w:.-]+)([\s\S]*?)\/?\s*>$/.exec(token);
    if (!opening || !/^(?:[A-Za-z_][\w.-]*:)?[A-Za-z_][\w.-]*$/.test(opening[1]) || ++nodes > 200000 || stack.length > 256) fail("Invalid or excessively complex SPL XML", 502);
    const { local, uri, attrs, ns } = splTagAttributes(opening, stack);
    if (!stack.length) {
      if (rootSeen || local !== "document" || uri !== "urn:hl7-org:v3") fail("Expected one HL7 SPL document", 502);
      rootSeen = true;
    } else if (stack.length === 1 && uri === "urn:hl7-org:v3" && ["id", "setId", "versionNumber", "effectiveTime"].includes(local ?? "")) {
      if (Object.prototype.hasOwnProperty.call(fields, local!)) fail("Duplicate SPL document identity field", 502);
      fields[local!] = attrs[local === "id" || local === "setId" ? "root" : "value"] ?? "";
    }
    if (!/\/\s*>$/.test(token)) stack.push({name: opening[1], ns});
  }
  return validatedSplIdentity(rootSeen, stack, xml, end, fields);
}

export type ReadJson = (path: string, params: Record<string, unknown>, deadline: number) => Promise<Record<string, unknown>>;
function validatedSplIdentity(rootSeen: boolean, stack: { name: string; ns: Record<string, string>; }[], xml: string, end: number, fields: Record<string, string>) {
  if (!rootSeen || stack.length || xml.slice(end).trim() || !UUID.test(fields.setId ?? "") || !UUID.test(fields.id ?? "") || !/^\d+$/.test(fields.versionNumber ?? "") || Number(fields.versionNumber) < 1) fail("SPL document identity is missing or invalid", 502);
  return { setid: fields.setId.toLowerCase(), document_id: fields.id.toLowerCase(), spl_version: fields.versionNumber, effective_time: fields.effectiveTime || null };
}

function splTagAttributes(opening: RegExpExecArray, stack: { name: string; ns: Record<string, string>; }[]) {
  const attrs: Record<string, string> = Object.create(null);
  let rest = opening[2];
  while (rest.trim()) {
    const attr = /^\s+([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(rest);
    if (!attr || Object.prototype.hasOwnProperty.call(attrs, attr[1])) fail("Invalid SPL XML attributes", 502);
    attrs[attr[1]] = attr[2] ?? attr[3]; rest = rest.slice(attr[0].length);
  }
  const ns = { ...stack[stack.length - 1]?.ns };
  for (const [key, value] of Object.entries(attrs)) if (key === "xmlns" || key.startsWith("xmlns:")) ns[key === "xmlns" ? "" : key.slice(6)] = value;
  const names = opening[1].split(":");
  const local = names[names.length - 1]; const uri = ns[names.length === 1 ? "" : names[0]];
  return { local, uri, attrs, ns };
}

export async function timeline(setid: string, params: Record<string, unknown>, read: ReadJson) {
  const { maxPages, expected, since, until } = timelineOptions(params);
  const deadline = Date.now() + 50_000;
  const pages: Record<string, unknown>[] = []; const revisions: Record<string, unknown>[] = [];
  let totalBytes = 0;
  let dbDate: unknown; let next: number | null = 1; let total: unknown;
  for (let page = 1; page <= maxPages && next !== null; page++) {
    const result = await read(`/spls/${setid}/history.json`, {page, pagesize: 100}, deadline);
    totalBytes += new TextEncoder().encode(JSON.stringify(result)).byteLength;
    if (totalBytes > 8 * 1024 * 1024) fail("Combined DailyMed history exceeds 8 MiB; use smaller page cap", 502);
    if (!record(result.data) || !record(result.data.spl) || String(result.data.spl.setid).toLowerCase() !== setid.toLowerCase() || !Array.isArray(result.data.history) || !record(result.metadata)) fail("DailyMed history schema/setid mismatch", 502);
    if (result.data.history.length > 100) fail("DailyMed history exceeds requested page size", 502);
    const metadata = result.metadata;
    if (Number(metadata.current_page) !== page) fail("DailyMed history page mismatch", 502);
    if (page === 1) { dbDate = metadata.db_published_date ?? null; total = metadata.total_elements; }
    else if ((metadata.db_published_date ?? null) !== dbDate || metadata.total_elements !== total) fail("DailyMed history changed while paging; discard and retry", 409);
    if (expected !== undefined && expected !== dbDate) fail("DailyMed database date differs from expected_db_published_date", 409);
    pages.push(result);
    appendHistoryRevisions(result.data.history, revisions, setid);
    const rawNext = metadata.next_page;
    if (rawNext === null || rawNext === "null") next = null;
    else if (Number(rawNext) === page + 1) next = page + 1;
    else fail("DailyMed history pagination is missing or inconsistent", 502);
  }
  return selectTimelineInterval(revisions, total, next, since, until, setid, pages, dbDate);
}

function appendHistoryRevisions(history: unknown[], revisions: Record<string, unknown>[], setid: string) {
  for (const entry of history) {
    if (!record(entry) || !/^\d+$/.test(String(entry.spl_version)) || Number(entry.spl_version) < 1) fail("Invalid DailyMed history revision", 502);
    revisions.push({ ...entry, setid, publication_date_iso: publicationDate(entry.published_date) });
  }
}

function timelineOptions(params: Record<string, unknown>) {
  const allowed = ["since", "until", "max_pages", "expected_db_published_date"];
  if (Object.keys(params).some(key => !allowed.includes(key))) fail("Unsupported timeline option");
  const since = isoDate(params.since); const until = isoDate(params.until);
  if (since > until) fail("since must be no later than until");
  const maxPages = positiveInteger(params.max_pages, 5, 10, "max_pages");
  const expected = params.expected_db_published_date;
  if (expected !== undefined && (typeof expected !== "string" || !expected || expected.length > 100)) fail("Invalid expected_db_published_date");
  return { maxPages, expected, since, until };
}

function selectTimelineInterval(revisions: Record<string, unknown>[], total: unknown, next: number | null, since: string, until: string, setid: string, pages: Record<string, unknown>[], dbDate: unknown) {
  const seen = new Set<string>();
  for (const row of revisions) {
    if (seen.has(String(row.spl_version))) fail("Repeated DailyMed history version across pages; retry", 409);
    seen.add(String(row.spl_version));
  }
  const count = Number(total);
  if (next === null && (!Number.isSafeInteger(count) || count < 0 || count !== revisions.length)) fail("DailyMed history total does not match retrieved entries", 502);
  const complete = next === null;
  const dated = revisions.filter(row => typeof row.publication_date_iso === "string");
  const unknown = revisions.filter(row => row.publication_date_iso === null);
  const selected = dated.filter(row => String(row.publication_date_iso) >= since && String(row.publication_date_iso) <= until);
  const predecessors = dated.filter(row => String(row.publication_date_iso) < since);
  const lastPriorDate = predecessors.map(row => String(row.publication_date_iso)).sort().slice(-1)[0];
  return {
    setid, interval: { since, until, inclusive: true, date_semantics: "DailyMed publication date; not SPL effectiveTime, FDA approval date or a clinical change date" },
    revisions: selected, unknown_date_revisions: unknown,
    baseline_candidates: complete && !unknown.length ? predecessors.filter(row => row.publication_date_iso === lastPriorDate) : [],
    pages, _dailymed: {
      complete, pages_read: pages.length, next_page: next, db_published_date: dbDate,
      retrieved_at: new Date().toISOString(), date_selection_complete: complete && !unknown.length,
      historical_content_retrieved: false, content_changes_proven: false,
      consistency: "Observed history database date/count stable across retrieved pages; not an atomic snapshot. Same-day versions remain separate. Publication revisions do not prove a safety or clinical text change.",
      archive_url: "https://dailymed.nlm.nih.gov/dailymed/archives/index.cfm"
    }
  };
}
