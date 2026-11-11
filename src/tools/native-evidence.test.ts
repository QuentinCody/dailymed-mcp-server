import {afterEach,expect,it,vi} from "vitest";
vi.mock("cloudflare:workers",()=>({RpcTarget:class {},DurableObject:class {constructor(public ctx:unknown,public env:unknown){}}}));
import {verifyCitationEnvelope} from "@bio-mcp/shared";
import {fixture,recover} from "./staging-fixture";
import {setid,xml,zip} from "../lib/archive-fixture";
import native from "../lib/native-archive.fixture.json";
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
async function invoke(f:ReturnType<typeof fixture>,name:string,args:unknown,failed=false){
  const result=await f.tools[name].handler(args,{});
  expect(result.isError===true,JSON.stringify(result).slice(0,1000)).toBe(failed);
  const sc=result.structuredContent;let original=sc;let materialized:unknown;
  if(sc.staged){const full=await recover(f,sc.data_access_id,"");materialized=full;original=full.structuredContent;}
  let data=original.data;
  if(data?.__staged){data=await recover(f,data.data_access_id,"");materialized??=data;}
  const proof=await verifyCitationEnvelope({citation:sc._meta.citation,structuredContent:sc,toolArguments:args,...(materialized?{materialized:{value:materialized}}:{})});
  expect(proof.verification).toMatchObject({query:"verified",result:"verified"});
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(30720);
  return {sc,data,id:original.data?.data_access_id??sc.data_access_id};
}
it.each(["","mcp_"])("recovers exact historical XML and TEXT identifiers through %s Code Mode and SQLite",async prefix=>{
  const f=fixture();const document=xml().replace("</document>",`<component><text>${"α😀".repeat(10000)}</text></component></document>`);
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(zip({"label.xml":document,"image.jpg":"listed only"}))));
  try{
    const result=await invoke(f,prefix+"dailymed_execute",{code:`return await api.get('/labels/${setid}/archive',{expected_spl_version:'3'});`});
    expect(result.data).toMatchObject({spl_xml:document,setid,spl_version:"3",_dailymed:{member_crc32_verified:true,download_selector:"setid_version"}});
    expect(result.sc._meta.completeness).toMatchObject({complete:false,returned:1});
    const schema=await invoke(f,prefix+"dailymed_get_schema",{data_access_id:result.id});
    expect(Object.keys(schema.data.schema.tables)).toEqual(expect.arrayContaining(["spl_documents","label_context","archive_members","payloads"]));
    const ids=await invoke(f,prefix+"dailymed_query_data",{data_access_id:result.id,sql:"SELECT setid,spl_version,typeof(spl_version) AS version_type FROM spl_documents"});
    expect(ids.data.rows).toEqual([{setid,spl_version:"3",version_type:"text"}]);
    const fullXml=await invoke(f,prefix+"dailymed_query_data",{data_access_id:result.id,sql:"SELECT spl_xml FROM spl_documents"});
    expect(fullXml.data.rows).toEqual([{spl_xml:document}]);
    const members=await invoke(f,prefix+"dailymed_query_data",{data_access_id:result.id,sql:"SELECT native_json FROM archive_members ORDER BY _rowid"});
    expect(members.data.rows.map((row:any)=>JSON.parse(row.native_json))).toEqual(result.data.archive_members);
  }finally{f.close();}
});
it("retains archive HTML, native history, and distinct baseline projections",async()=>{
  const f=fixture();const active="e9481622-7cc6-418a-acb6-c5450daae9b0";
  const html=native.html+"<!--"+"λ".repeat(18000)+"-->";
  try{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(html,{headers:{"content-type":"text/html"}})));
    const listing=await invoke(f,"dailymed_execute",{code:`return await api.get('/labels/${active}/archives',{through:'2025-05-01'});`});
    expect(listing.data.source_html).toBe(html);
    const rows=await invoke(f,"dailymed_query_data",{data_access_id:listing.id,sql:"SELECT archive_id,spl_version,typeof(archive_id) AS id_type FROM archive_candidates ORDER BY _rowid"});
    expect(rows.data.rows.map((r:any)=>[r.archive_id,r.spl_version,r.id_type])).toEqual([["702293","29","text"],["635883","28","text"],["600406","27","text"],["573882","26","text"],["570795","25","text"]]);
    const history={...native.history,future:{text:"α".repeat(20000),values:["001",null,0]}};
    vi.mocked(fetch).mockImplementation(async()=>Response.json(history));
    const timeline=await invoke(f,"mcp_dailymed_execute",{code:`return await api.get('/labels/${active}/timeline',{since:'2025-01-01',until:'2025-05-31'});`});
    expect(timeline.data.pages).toEqual([history]);
    const versions=await invoke(f,"mcp_dailymed_query_data",{data_access_id:timeline.id,sql:"SELECT spl_version,'selected' AS role FROM revisions UNION ALL SELECT spl_version,'baseline' AS role FROM baseline_candidates"});
    expect(versions.data.rows).toEqual([{spl_version:"30",role:"selected"},{spl_version:"29",role:"baseline"}]);
  }finally{f.close();}
});
it("retains complete native errors and rejected XML with verifiable failure citations",async()=>{
  const f=fixture();const body="native error "+"α".repeat(22000);
  try{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(body,{status:404})));
    const failed=await invoke(f,"dailymed_execute",{code:`return await api.get('/labels/${setid}/archive',{expected_spl_version:'2'});`},true);
    const error=failed.data.data.__staged?await recover(f,failed.data.data.data_access_id,""):failed.data.data;
    expect(error.raw_body).toBe(body);expect(error.receipt.http_status).toBe(404);
    vi.mocked(fetch).mockImplementation(async()=>new Response(xml(),{headers:{"content-type":"application/xml"}}));
    const conflict=await invoke(f,"mcp_dailymed_execute",{code:`return await api.get('/spls/${setid}.xml',{expected_spl_version:'2'});`},true);
    expect(conflict.data.data.spl_xml).toBe(xml());expect(conflict.data.status).toBe(409);
  }finally{f.close();}
});
it("cites every alias and failure using exact caller arguments",async()=>{
  const f=fixture();
  try{
    expect(Object.keys(f.tools).sort()).toEqual(["search","execute","query_data","get_schema"].flatMap(name=>["dailymed_"+name,"mcp_dailymed_"+name]).sort());
    for(const prefix of ["","mcp_"]){
      await invoke(f,prefix+"dailymed_search",{query:"archive",max_results:3});
      await invoke(f,prefix+"dailymed_query_data",{data_access_id:"missing",sql:"SELECT * FROM missing"},true);
      await invoke(f,prefix+"dailymed_get_schema",{data_access_id:"missing"});
      await invoke(f,prefix+"dailymed_execute",{code:""},true);
    }
  }finally{f.close();}
});
