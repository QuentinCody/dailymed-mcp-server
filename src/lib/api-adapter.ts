import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import {fail, record, UUID, positiveInteger, sha256, splIdentity, timeline} from "./label-history";

import {dailymedRead as read} from "./http";
import {requestParts} from "./request";
import {dailymedCompleteness} from "./completeness";
import {readArchivedSpl, readArchives} from "./archives";
import {compatibilityPath} from "./compatibility";

async function readJson(path: string, params: Record<string, unknown>, deadline?: number) {
  const result = await read(path, params, deadline);
  let data: unknown;
  const invalid=(message:string):never=>{throw Object.assign(new Error(message),{status:502,data:{raw_body:result.text,receipt:result.receipt}});};
  try { data = JSON.parse(result.text.replace(/^\uFEFF/,"")); } catch { invalid("DailyMed returned invalid JSON"); }
  if (!result.receipt.content_type?.includes("json")) invalid("Expected DailyMed JSON content type");
  if (!record(data) || !("data" in data) || !record(data.metadata)) invalid("DailyMed returned an error or unrecognized JSON envelope");
  return {native:data as Record<string,unknown>,receipt:result.receipt};
}
export function createDailymedApiFetch(): ApiFetchFn {
  return async request => {
    if (request.method !== "GET" || request.body !== undefined) fail("DailyMed supports read-only GET requests");
    const original=requestParts(request.path,request.params);
    const {path,params,compatibility}=compatibilityPath(original.path,original.params);

    const local = /^\/labels\/([^/]+)\/(timeline|archives|archive)$/.exec(path);
    if (local) {
      return await readLabelHistory(local, params);
    }
    if (params.page !== undefined) params.page = positiveInteger(params.page, 1, 1000000, "page");
    if (params.pagesize !== undefined) params.pagesize = positiveInteger(params.pagesize, 100, 100, "pagesize");
    const expectedVersion = params.expected_spl_version; delete params.expected_spl_version;
    const expectedHash = params.expected_xml_sha256; delete params.expected_xml_sha256;
    const xml = /^\/spls\/([^/.]+)\.xml$/.exec(path);
    if (!xml && (expectedVersion !== undefined || expectedHash !== undefined)) fail("XML identity guards only apply to /spls/{setid}.xml");
    if (xml) {
      return await readCurrentSpl(path, params, xml, expectedVersion, expectedHash);
    }
    if (path.endsWith(".xml")) {
      const result = await read(path, params);
      if (!result.receipt.content_type?.includes("xml")) throw Object.assign(new Error("Expected DailyMed XML content type"),{status:502,data:{raw_body:result.text,receipt:result.receipt}});
      return output({content_type: "application/xml", spl_xml: result.text, length: result.text.length, source_url: result.source_url,receipt:result.receipt, document_identity_verified: false});
    }
    const result=await readJson(path,params);
    return output({...result.native,_dailymed:{receipt:result.receipt,...(compatibility?{compatibility}:{} )}});
  };
}

function output(data: unknown) { return {status:200,data,completeness:dailymedCompleteness(data)}; }

async function readLabelHistory(local: RegExpExecArray, params: Record<string, unknown>) {
  if (!UUID.test(local[1])) fail("Invalid SPL setid");
  const setid=local[1].toLowerCase();
  if(local[2]==="archives")return output(await readArchives(setid,params));
  if(local[2]==="archive")return output(await readArchivedSpl(setid,params));
  const observed:Awaited<ReturnType<typeof readJson>>[]=[];
  try {
    const data=await timeline(setid,params,async (...args)=>{const result=await readJson(...args);observed.push(result);return result.native;});
    return output({...data,page_receipts:observed.map(result=>result.receipt)});
  } catch(error){throw Object.assign(new Error(error instanceof Error?error.message:"DailyMed timeline failed"),{status:error&&typeof error==="object"&&"status" in error?error.status:502,
    data:{observations:observed,...(error&&typeof error==="object"&&"data" in error?{upstream_error:error.data}:{})}});}
}

async function readCurrentSpl(path: string, params: Record<string, unknown>, xml: RegExpExecArray, expectedVersion: unknown, expectedHash: unknown) {
  if (!UUID.test(xml[1])) fail("Invalid SPL setid");
  if (Object.keys(params).length) fail("Current SPL XML has no documented historical-version selector; use archives for older content");
  if (expectedVersion !== undefined && (!["string", "number"].includes(typeof expectedVersion) || String(expectedVersion).length > 100 || !/^[1-9]\d*$/.test(String(expectedVersion)))) fail("Invalid expected_spl_version");
  if (expectedHash !== undefined && (typeof expectedHash !== "string" || !/^[a-f\d]{64}$/i.test(expectedHash))) fail("Invalid expected_xml_sha256");
  const result = await read(path, {});
  try {
  if (!result.receipt.content_type?.includes("xml")) fail("Expected DailyMed XML content type",502);
  const identity = splIdentity(result.text);
  if (identity.setid !== xml[1].toLowerCase()) fail("DailyMed XML setid differs from requested label", 502);
  if (expectedVersion !== undefined && identity.spl_version !== String(expectedVersion)) fail("DailyMed current XML differs from expected_spl_version; use archive content for older versions", 409);
  const hash = await sha256(result.raw);
  if (expectedHash !== undefined && hash !== String(expectedHash).toLowerCase()) fail("DailyMed XML checksum differs from expected_xml_sha256", 409);
  return output({content_type: "application/xml", spl_xml: result.text, ...identity, length: result.text.length,
    _dailymed: {source_url: result.source_url, retrieved_at: new Date().toISOString(), xml_sha256: hash, bytes: result.raw.length, historical_snapshot: false,
      date_semantics: "effective_time is the raw SPL document date reference, not DailyMed publication date or FDA approval date"}});
  } catch(error){throw Object.assign(new Error(error instanceof Error?error.message:"Invalid DailyMed SPL"),{status:error&&typeof error==="object"&&"status" in error?error.status:502,data:{spl_xml:result.text,receipt:result.receipt}});}
}
