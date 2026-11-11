import {afterEach, expect, it, vi} from "vitest";
import {createDailymedApiFetch} from "./api-adapter";
import {isoDate, publicationDate, splIdentity, timeline} from "./label-history";
const id = "9aa7140c-012c-4ea6-866d-4732e915dab6";
const doc = "1efe378e-fee1-4ae9-8ea5-0fe2265fe2d8";
export const xmlFixture = `<document xmlns="urn:hl7-org:v3"><id root="${doc}"/><effectiveTime value="20260801"/><setId root="${id}"/><versionNumber value="3"/><component><section><code code="34066-1"/><text>A &amp; B</text></section></component></document>`;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status, headers: {"Content-Type": "application/json"}});
const page = (entries: unknown[], current = 1, next: unknown = null, total = entries.length) => ({data: {spl: {setid: id, title: "Synthetic label"}, history: entries}, metadata: {current_page: String(current), next_page: next, total_elements: String(total), db_published_date: "Sep 28, 2026 12:00:00PM EDT"}});
const entries = [
  {spl_version: "4", published_date: "Sep 28, 2026"},
  {spl_version: "3", published_date: "Aug 01, 2026"},
  {spl_version: "2", published_date: "Jul 31, 2026"},
  {spl_version: "1", published_date: "Jul 31, 2026"},
];
const interval = {since: "2026-08-01", until: "2026-09-28"};
afterEach(() => {vi.unstubAllGlobals(); vi.restoreAllMocks();});
it("retains version/date fields and same-day baseline candidates without assuming one predecessor", async () => {
  const native = page(entries); const read = vi.fn().mockResolvedValue(native);
  const result = await timeline(id, interval, read);
  expect(result.revisions.map(row => row.spl_version)).toEqual(["4", "3"]);
  expect(result.baseline_candidates.map(row => row.spl_version)).toEqual(["2", "1"]);
  expect(result.pages).toEqual([native]);
  expect(result._dailymed).toMatchObject({complete: true, date_selection_complete: true, historical_content_retrieved: false, content_changes_proven: false});
});
it("does not claim complete history or a baseline after hitting a local page cap", async () => {
  const read = vi.fn().mockResolvedValue(page(entries, 1, "2", 101));
  const result = await timeline(id, {...interval, max_pages: 1}, read);
  expect(result._dailymed).toMatchObject({complete: false, next_page: 2, pages_read: 1});
  expect(result.baseline_candidates).toEqual([]); expect(read).toHaveBeenCalledTimes(1);
});
it("retains unparseable dates and makes temporal selection incomplete", async () => {
  const result = await timeline(id, interval, vi.fn().mockResolvedValue(page([...entries, {spl_version: "5", published_date: "unknown"}])));
  expect(result.unknown_date_revisions).toMatchObject([{spl_version: "5", published_date: "unknown", publication_date_iso: null}]);
  expect(result._dailymed).toMatchObject({complete: true, date_selection_complete: false}); expect(result.baseline_candidates).toEqual([]);
});
it("paginates with request page numbers, not arbitrary provider URLs", async () => {
  const read = vi.fn().mockResolvedValueOnce({...page([entries[0]], 1, "2", 2), metadata: {...page([], 1, "2", 2).metadata, next_page_url: "https://evil.example"}}).mockResolvedValueOnce(page([entries[1]], 2, "null", 2));
  const result = await timeline(id, interval, read);
  expect(result._dailymed.complete).toBe(true); expect(read.mock.calls[1][0]).toBe(`/spls/${id}/history.json`); expect(read.mock.calls[1][1]).toEqual({page: 2, pagesize: 100});
});
it.each(["db_published_date", "total_elements"])("rejects changed history metadata %s across pages", async key => {
  const second = page([entries[1]], 2, null, 2); second.metadata = {...second.metadata, [key]: "changed"};
  const read = vi.fn().mockResolvedValueOnce(page([entries[0]], 1, 2, 2)).mockResolvedValueOnce(second);
  await expect(timeline(id, interval, read)).rejects.toMatchObject({status: 409});
});
it("checks caller's exact raw database publication date", async () => {
  await expect(timeline(id, {...interval, expected_db_published_date: "older"}, vi.fn().mockResolvedValue(page(entries)))).rejects.toMatchObject({status: 409});
});
it.each([
  {...page(entries), data: {spl: {setid: doc}, history: entries}},
  page(entries, 2), page(entries, 1, 7), page(entries, 1, undefined, 9), page([entries[0], entries[0]]),
  {...page(entries), metadata: {}}, page([{spl_version: "invalid", published_date: "Sep 28, 2026"}]),
])("rejects inconsistent native history %#", async native => {
  await expect(timeline(id, interval, vi.fn().mockResolvedValue(native))).rejects.toThrow();
});
it.each([{since: "2026-02-30"}, {until: "2020-01-01"}, {max_pages: 11}, {max_pages: 0}, {extra: 1}])("validates timeline options before network %#", async options => {
  const read = vi.fn(); await expect(timeline(id, {...interval, ...options}, read)).rejects.toMatchObject({status: 400}); expect(read).not.toHaveBeenCalled();
});
it("uses strict dates instead of permissive Date parsing", () => {
  expect(publicationDate("Feb 29, 2024")).toBe("2024-02-29"); expect(publicationDate("Feb 29, 2025")).toBeNull();
  expect(publicationDate("2026-09-28")).toBe("2026-09-28"); expect(() => isoDate("09/28/2026")).toThrow();
});
it("extracts direct root identity while preserving raw date precision", () => {
  expect(splIdentity(xmlFixture)).toEqual({setid: id, document_id: doc, spl_version: "3", effective_time: "20260801"});
  const nested = xmlFixture.replace('<section>', '<section><setId root="different"/><versionNumber value="99"/>');
  expect(splIdentity(nested).spl_version).toBe("3");
});
it("supports prefixed HL7 elements, quoted >, comments and CDATA without spoofing identity", () => {
  const prefixed = xmlFixture.replace(/<(\/?)(\w+)/g, '<$1h:$2').replace('xmlns=', 'xmlns:h=').replace('<h:component>', '<h:component note="A > B"><![CDATA[<setId root="fake"/>]]><!-- <versionNumber value="99"/> -->');
  expect(splIdentity(prefixed).setid).toBe(id);
});
it.each([
  xmlFixture.replace('urn:hl7-org:v3', 'urn:other'), xmlFixture.replace('<setId', '<wrong'),
  xmlFixture.replace('<component>', '<setId root="duplicate"/><component>'),
  xmlFixture.replace('</document>', ''), xmlFixture + xmlFixture,
  '<!DOCTYPE document [<!ENTITY x "boom">]>' + xmlFixture,
  xmlFixture.replace('</section>', '</wrong>'), xmlFixture.replace('value="3"', 'value="0"'),
  xmlFixture.replace(`<setId root="${id}"/>`, `<other:setId xmlns:other="urn:other" root="${id}"/>`),
])("rejects invalid/spoofed SPL document identity %#", xml => expect(() => splIdentity(xml)).toThrow());
it("keeps XML verbatim and checks local version/hash without sending selectors upstream", async () => {
  const fetcher = vi.fn().mockImplementation(async () => new Response(xmlFixture,{headers:{"Content-Type":"application/xml"}})); vi.stubGlobal("fetch", fetcher);
  const api = createDailymedApiFetch();
  const first = await api({method: "GET", path: `/spls/${id}.xml`, params: {expected_spl_version: "3"}});
  expect(first.data).toMatchObject({spl_xml: xmlFixture, setid: id, spl_version: "3", _dailymed: {historical_snapshot: false, xml_sha256: expect.stringMatching(/^[a-f\d]{64}$/)}});
  expect((fetcher.mock.calls[0][0] as URL).search).toBe(""); expect(fetcher.mock.calls[0][1]).toMatchObject({redirect: "manual", headers: {Accept: "*/*"}});
  await expect(api({method: "GET", path: `/spls/${id}.xml`, params: {expected_spl_version: "2"}})).rejects.toMatchObject({status: 409});
  await expect(api({method: "GET", path: `/spls/${id}.xml`, params: {expected_xml_sha256: "0".repeat(64)}})).rejects.toMatchObject({status: 409});
});
it("rejects XML belonging to a different label", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(xmlFixture,{headers:{"Content-Type":"application/xml"}})));
  await expect(createDailymedApiFetch()({method: "GET", path: `/spls/${doc}.xml`})).rejects.toMatchObject({status: 502});
});
it.each([
  {method: "POST", path: "/spls.json"}, {method: "GET", path: "https://evil.example"},
  {method: "GET", path: "/../spls.json"}, {method: "GET", path: "/spls.json", params: {pagesize: 101}},
  {method: "GET", path: `/spls/${id}.xml`, params: {version: 2}},
  {method: "GET", path: "/spls.json", params: {expected_spl_version: 2}},
])("rejects unsafe/unsupported requests %#", async request => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); await expect(createDailymedApiFetch()(request)).rejects.toMatchObject({status: 400}); expect(fetcher).not.toHaveBeenCalled();
});
it.each([401, 404, 429, 500])("preserves failure for upstream HTTP %s", async status => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({error: "synthetic"}, status)));
  await expect(createDailymedApiFetch()({method: "GET", path: "/spls.json"})).rejects.toMatchObject({status});
});
it("rejects oversized responses and invalid JSON", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("x".repeat(8 * 1024 * 1024 + 1))).mockResolvedValueOnce(new Response("<html>error</html>")));
  const api = createDailymedApiFetch();
  await expect(api({method: "GET", path: "/spls.json"})).rejects.toThrow("8 MiB");
  await expect(api({method: "GET", path: "/spls.json"})).rejects.toThrow("invalid JSON");
});
