import { fail, isoDate, positiveInteger, publicationDate, splIdentity, UUID } from "./label-history";
import { publicRead, responseText } from "./read";
import { zipMember, zipMembers } from "./archive-zip";

const site = "https://dailymed.nlm.nih.gov";
const decodeLink = (value: string) => value.replace(/&amp;/g,"&");
const requireHash = (value: unknown, name: string) => { if (value !== undefined && (typeof value !== "string" || !/^[a-f\d]{64}$/i.test(value))) fail(`Invalid ${name}`); };

/** Parse listing metadata only; keep original HTML and verify label identity against downloaded XML separately. */
export function archiveListing(html: string, setid: string, through: string, page: number) {
  if (!html.includes('action="/dailymed/archives/index.cfm"')) fail("Unrecognized DailyMed archive listing",502);
  const candidates = [...html.matchAll(/<div class="desktop">([\s\S]*?)<div class="mobile">/g)].map(match => {
    const block=match[1];
    const download=/href="(\/dailymed\/getArchivalFile\.cfm\?archive_id=(\d+))"/.exec(block);
    const detail=/href="(\/dailymed\/archives\/fdaDrugInfo\.cfm\?archiveid=(\d+))"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    const version=/<div class="version">\s*Version:\s*<span>(\d+)<\/span>/.exec(block);
    const date=/<div class="date">\s*([^<]+)</.exec(block)?.[1].trim();
    if (!download || !detail || !version || download[2]!==detail[2] || !date) fail("Unrecognized DailyMed archive row",502);
    const parsed=publicationDate(date);
    if (!parsed || parsed>through) fail("Archive date filter is inconsistent",502);
    return {archive_id:download[2],spl_version:version[1],published_date:date,publication_date_iso:parsed,
      title_html:detail[3],download_url:site+download[1],detail_url:site+detail[1],native_html:match[0],document_identity_verified:false};
  });
  const ids=new Set(candidates.map(row=>row.archive_id));
  const links=new Set([...html.matchAll(/getArchivalFile\.cfm\?archive_id=(\d+)/g)].map(match=>match[1]));
  if (ids.size!==candidates.length || ids.size!==links.size || [...links].some(id=>!ids.has(id))) fail("Archive listing has duplicate or unparsed downloads",502);
  const controls=[...html.matchAll(/<select\b(?=[^>]*\bname="page")(?=[^>]*\bvalue="(\d+)")[^>]*>([\s\S]*?)<\/select>/g)];
  let { total_pages, next_page, next_url } = validateArchivePaging(candidates, controls, page, html, setid, through);
  return {requested_setid:setid,through,page,total_pages,next_page,next_page_url:next_url?.href??null,candidates,source_html:html,
    _dailymed:{complete:false,document_identity_verified:false,historical_content_retrieved:false,
      scope:"One provider archive-listing page through the requested date, not a unique as-of label or exhaustive history. Download an explicit archive and verify setid/version before comparison."}};
}

function validateArchivePaging(candidates: { archive_id: string; spl_version: string; published_date: string; publication_date_iso: string; title_html: string; download_url: string; detail_url: string; native_html: string; document_identity_verified: boolean; }[], controls: RegExpExecArray[], page: number, html: string, setid: string, through: string) {
  let total_pages = 0;
  if (candidates.length) {
    if (!controls.length || controls.some(match => Number(match[1]) !== page)) fail("Archive page control mismatch", 502);
    const totals = controls.map(match => Math.max(...[...match[2].matchAll(/<option\b[^>]*>\s*(\d+)\s*<\/option>/g)].map(option => Number(option[1]))));
    if (!Number.isSafeInteger(totals[0]) || totals[0] < page || totals.some(total => total !== totals[0])) fail("Archive page count mismatch", 502);
    total_pages = totals[0];
  } else if (!html.includes('class="no-drugs-found"') || !html.includes("No Drug Package Labels found.")) fail("Archive listing did not establish an empty result", 502);
  const nextLinks = [...new Set([...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*title="Next"/g)].map(match => decodeLink(match[1])))];
  const next_page = page < total_pages ? page + 1 : null;
  if (nextLinks.length !== (next_page === null ? 0 : 1)) fail("Archive continuation mismatch", 502);
  const next_url = nextLinks[0] ? new URL(nextLinks[0], site) : null;
  if (next_url && (next_url.origin !== site || next_url.pathname !== "/dailymed/archives/index.cfm" || next_url.searchParams.get("query")?.toLowerCase() !== setid || Number(next_url.searchParams.get("page")) !== next_page || next_url.searchParams.get("date") !== `${through.slice(5, 7)}/${through.slice(8)}/${through.slice(0, 4)}`)) fail("Unexpected archive continuation URL", 502);
  return { total_pages, next_page, next_url };
}

export async function readArchives(setid: string, params: Record<string,unknown>) {
  if (!UUID.test(setid) || Object.keys(params).some(key=>!["through","page"].includes(key))) fail("Archives accepts a setid, through date and optional page");
  const through=isoDate(params.through);const page=positiveInteger(params.page,1,1000000,"page");
  const result=await publicRead("/archives/index.cfm",{query:setid,date:`${through.slice(5,7)}/${through.slice(8)}/${through.slice(0,4)}`,page,pagesize:5},undefined,"text/html");
  const html=responseText(result);
  try {return {...archiveListing(html,setid,through,page),receipt:result.receipt};}
  catch(error){throw Object.assign(new Error(error instanceof Error?error.message:"Invalid archive listing"),{status:502,data:{source_html:html,receipt:result.receipt}});}
}

export async function readArchivedSpl(setid: string, params: Record<string,unknown>) {
  let { result, members, observed_xml }: { result: { raw: Uint8Array<ArrayBufferLike>; source_url: string; receipt: { source_url: string; retrieved_at: string; http_status: number; bytes: number; response_sha256: string; content_type: string | null; }; }; members: import("./archive-zip").ArchiveMember[]; observed_xml: { spl_xml: string; xml_sha256: string; } | undefined; } = await readArchiveDownload(setid, params);
  try {
    if (params.expected_archive_sha256!==undefined && String(params.expected_archive_sha256).toLowerCase()!==result.receipt.response_sha256) fail("DailyMed archive checksum differs from expected_archive_sha256",409);
    members=zipMembers(result.raw);const xmls=members.filter(member=>member.name.toLowerCase().endsWith(".xml"));
    if (xmls.length!==1) fail("Expected exactly one SPL XML member in archive",502);
    const extracted=await zipMember(result.raw,xmls[0]);const text=responseText({...result,raw:extracted.bytes});
    observed_xml={spl_xml:text,xml_sha256:extracted.member_sha256};
    const identity=splIdentity(text);
    if (identity.setid!==setid || identity.spl_version!==params.expected_spl_version) fail("Archived SPL setid/version differs from the requested identity",409);
    if (params.expected_xml_sha256!==undefined && String(params.expected_xml_sha256).toLowerCase()!==extracted.member_sha256) fail("DailyMed archived XML checksum differs from expected_xml_sha256",409);
    return {content_type:"application/xml",spl_xml:text,...identity,length:text.length,archive_id:params.archive_id??null,archive_members:members,
      _dailymed:{source_url:result.source_url,retrieved_at:result.receipt.retrieved_at,archive_sha256:result.receipt.response_sha256,archive_bytes:result.raw.length,
        download_selector:params.archive_id===undefined?"setid_version":"archive_id",
        xml_member:xmls[0].name,xml_sha256:extracted.member_sha256,bytes:extracted.bytes.length,member_crc32_verified:true,historical_snapshot:true,
        publication_date:null,date_semantics:"Archive XML identity verified; effective_time is not a publication/approval date. Join publication history by exact setid and version. Images are listed, not extracted."}};
  } catch(error) {
    throw Object.assign(new Error(error instanceof Error?error.message:"Invalid DailyMed archive"),{status:error&&typeof error==="object"&&"status" in error?error.status:502,
      data:{receipt:result.receipt,archive_members:members,observed_xml,archive_body_included:false}});
  }
}

async function readArchiveDownload(setid: string, params: Record<string, unknown>) {
  if (!UUID.test(setid) || Object.keys(params).some(key => !["archive_id", "expected_spl_version", "expected_xml_sha256", "expected_archive_sha256"].includes(key))) fail("Unsupported archive download options");
  if (params.archive_id !== undefined && (typeof params.archive_id !== "string" || !/^[1-9]\d{0,14}$/.test(params.archive_id))) fail("archive_id must be an observed positive archive identifier");
  if (typeof params.expected_spl_version !== "string" || !/^[1-9]\d{0,14}$/.test(params.expected_spl_version)) fail("expected_spl_version is required for archive retrieval");
  requireHash(params.expected_xml_sha256, "expected_xml_sha256"); requireHash(params.expected_archive_sha256, "expected_archive_sha256");
  const result = params.archive_id === undefined
    ? await publicRead("/getFile.cfm", { type: "zip", setid, version: params.expected_spl_version })
    : await publicRead("/getArchivalFile.cfm", { archive_id: params.archive_id });
  let members: ReturnType<typeof zipMembers> = [];
  let observed_xml: { spl_xml: string; xml_sha256: string; } | undefined;
  return { result, members, observed_xml };
}
