import {afterEach, expect, it, vi} from "vitest";
import {McpServer} from "@bio-mcp/shared/mcp";
import {createApiProxyTool} from "@bio-mcp/shared/tools/api-proxy";
import {registerCodeMode} from "./code-mode";
import {registerGetSchema} from "./get-schema";
import {registerQueryData} from "./query-data";
import {dailymedCatalog} from "../spec/catalog";
import {createDailymedApiFetch} from "../lib/api-adapter";
const json = (data: unknown) => new Response(JSON.stringify(data), {headers: {"Content-Type": "application/json"}});
afterEach(() => vi.unstubAllGlobals());
it("registers all four tools under both aliases with both fields on success/error", async () => {
  const server = new McpServer({name: "fixture", version: "1"});
  registerCodeMode(server, {CODE_MODE_LOADER: {get: () => ({})}} as unknown as Parameters<typeof registerCodeMode>[1]);
  registerGetSchema(server, {}); registerQueryData(server, {});
  const tools = (server as unknown as {_registeredTools: Record<string, {handler: (args: unknown, extra: unknown) => Promise<unknown>}>})._registeredTools;
  for (const suffix of ["search", "execute", "query_data", "get_schema"]) {
    expect(tools[`dailymed_${suffix}`]).toBeDefined(); expect(tools[`mcp_dailymed_${suffix}`]).toBeDefined();
  }
  expect(await tools.dailymed_search.handler({query: "timeline", max_results: 5}, {})).toMatchObject({content: expect.any(Array), structuredContent: {success: true}});
  expect(await tools.mcp_dailymed_query_data.handler({data_access_id: "fixture", sql: "SELECT 1"}, {})).toMatchObject({isError: true, content: expect.any(Array), structuredContent: expect.any(Object)});
});
it("stages full XML with its identity, checksum and retrieval context", async () => {
  const setid = "9aa7140c-012c-4ea6-866d-4732e915dab6";
  const xml = `<document xmlns="urn:hl7-org:v3"><id root="1efe378e-fee1-4ae9-8ea5-0fe2265fe2d8"/><setId root="${setid}"/><versionNumber value="3"/><component><text>${"α".repeat(40000)}</text></component></document>`;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(xml,{headers:{"Content-Type":"application/xml"}})));
  const stored: unknown[] = [];
  const namespace = {idFromName: (name: string) => name, get: () => ({fetch: async (request: Request) => {
    if (new URL(request.url).pathname === "/process") { stored.push((await request.json() as {data: unknown}).data); return json({success: true, tables_created: ["payloads"], total_rows: 1}); }
    return json({success: true, schema: {tables: {payloads: {columns: [{name: "root_json"}]}}}});
  }})} as unknown as DurableObjectNamespace;
  const proxy = createApiProxyTool({apiFetch: createDailymedApiFetch(), catalog: dailymedCatalog, doNamespace: namespace, stagingPrefix: "dailymed", maxInlineBytes: 30 * 1024});
  const result = await proxy.handler({method: "GET", path: `/spls/${setid}.xml`, params: {expected_spl_version: "3"}}, {sql: () => []});
  expect(result).toMatchObject({__staged: true, data_access_id: expect.any(String)});
  expect(JSON.parse(stored[0] as string)).toMatchObject({spl_xml: xml, setid, spl_version: "3", _dailymed: {xml_sha256: expect.stringMatching(/^[a-f0-9]{64}$/)}});
  expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThan(100000);
});
it("retains staged handles in the version-checked recipe", async () => {
  const recipe = dailymedCatalog.workflows!.find(recipe => recipe.title === "Version-checked current SPL XML")!;
  const get = vi.fn().mockResolvedValueOnce({data: [{setid: "e9481622-7cc6-418a-acb6-c5450daae9b0", spl_version: 3}], metadata: {}}).mockResolvedValueOnce({__staged: true, data_access_id: "fixture"});
  const run = new Function("api", `return (async () => {${recipe.code}})()`);
  expect(await run({get})).toMatchObject({xml: {__staged: true, data_access_id: "fixture"}});
  expect(get.mock.calls[1][1]).toEqual({expected_spl_version: "3"});
});
it("returns version conflicts as incomplete API errors", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('<document xmlns="urn:hl7-org:v3"><id root="1efe378e-fee1-4ae9-8ea5-0fe2265fe2d8"/><setId root="9aa7140c-012c-4ea6-866d-4732e915dab6"/><versionNumber value="3"/></document>',{headers:{"Content-Type":"application/xml"}})));
  const proxy = createApiProxyTool({apiFetch: createDailymedApiFetch(), catalog: dailymedCatalog, stagingPrefix: "dailymed"});
  expect(await proxy.handler({method: "GET", path: "/spls/9aa7140c-012c-4ea6-866d-4732e915dab6.xml", params: {expected_spl_version: "2"}}, {sql: () => []})).toMatchObject({__api_error: true, incomplete: true, status: 409});
});
