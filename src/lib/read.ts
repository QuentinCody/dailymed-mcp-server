import { decodeResponseText, readResponseBytes } from "@bio-mcp/shared/http/response-reader";
import { fail, sha256 } from "./label-history";

/** Fixed-origin public reads. Body and header deadlines remain bounded even if abort is ignored. */
export async function publicRead(path: string, params: Record<string, unknown>, deadline = Date.now() + 45000, accept = "*/*") {
  if (!path.startsWith("/") || path.startsWith("//") || /[?#\\]/.test(path) || path.split("/").some(part => part === ".." || part === ".")) fail("Unsupported DailyMed path");
  const url = new URL("https://dailymed.nlm.nih.gov/dailymed" + path);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (!["string", "number", "boolean"].includes(typeof value) || key.length > 100 || String(value).length > 2000) fail("Unsupported DailyMed query value");
    url.searchParams.set(key, String(value));
  }
  const remaining = deadline - Date.now(); if (remaining <= 0) fail("DailyMed deadline exceeded", 504);
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error("DailyMed request deadline exceeded"), {status:504,data:{source_url:url.href,body_unavailable:true}})); }, remaining); });
  try {
    const response = await Promise.race([fetch(url,{headers:{Accept:accept},redirect:"manual",signal:controller.signal}).catch(() => {
      throw Object.assign(new Error("DailyMed network request failed"),{status:502,data:{source_url:url.href,body_unavailable:true}});
    }),timeout]);
    return await readPublicEvidence(response, deadline, url);
  } finally {if(timer!==undefined)clearTimeout(timer);controller.abort();}
}

async function readPublicEvidence(response: Response, deadline: number, url: URL) {
  let raw: Uint8Array;
  try { raw = await readResponseBytes(response, { label: "DailyMed", maxBytes: 8 * 1024 * 1024, timeoutMs: Math.min(10000, deadline - Date.now()) }); }
  catch (error) {
    const status = error && typeof error === "object" && "status" in error ? error.status : 502;
    const message = status === 413 ? "DailyMed response exceeds 8 MiB" : status === 504 ? "DailyMed body read deadline exceeded" : String(error);
    throw Object.assign(new Error(message), { status: response.ok ? status : response.status, data: { source_url: url.href, http_status: response.status, body_unavailable: true, body_error: message, retry_after: response.headers.get("retry-after") } });
  }
  const receipt = {
    source_url: url.href, retrieved_at: new Date().toISOString(), http_status: response.status, bytes: raw.length,
    response_sha256: await sha256(raw), content_type: response.headers.get("content-type")
  };
  if (!response.ok || response.status !== 200 || response.headers.has("content-range")) {
    let raw_body: string | undefined; try { raw_body = decodeResponseText(raw, "DailyMed"); } catch { /* Receipt still identifies non-text errors. */ }
    throw Object.assign(new Error(response.ok ? "DailyMed returned a partial representation" : `DailyMed HTTP ${response.status}`), {
      status: response.ok ? 502 : response.status,
      data: { receipt, raw_body, ...(raw_body === undefined ? { body_unavailable: true } : {}), retry_after: response.headers.get("retry-after") }
    });
  }
  return { raw, source_url: url.href, receipt };
}

export function responseText(result: Awaited<ReturnType<typeof publicRead>>) {
  try {return decodeResponseText(result.raw,"DailyMed");}
  catch(error){throw Object.assign(new Error("Invalid DailyMed UTF-8"),{status:502,data:{receipt:result.receipt,body_unavailable:true,cause:String(error)}});}
}
