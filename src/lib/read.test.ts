import {afterEach,expect,it,vi} from "vitest";
import {publicRead,responseText} from "./read";
import {createDailymedApiFetch} from "./api-adapter";
import {readArchivedSpl} from "./archives";
import {setid,xml,zip} from "./archive-fixture";
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it("bounds headers even when fetch ignores abort",async()=>{
  vi.useFakeTimers();vi.stubGlobal("fetch",vi.fn(()=>new Promise(()=>{})));
  const result=publicRead("/services/v2/spls.json",{},Date.now()+25);
  const rejection=expect(result).rejects.toMatchObject({status:504,data:{body_unavailable:true}});
  await vi.advanceTimersByTimeAsync(30);await rejection;
});
it("bounds stalled bodies and rejects oversized advertised bodies",async()=>{
  vi.useFakeTimers();vi.stubGlobal("fetch",vi.fn(async()=>new Response(new ReadableStream({pull(){}}))));
  const pending=expect(publicRead("/services/v2/spls.json",{},Date.now()+30)).rejects.toMatchObject({status:504});
  await vi.advanceTimersByTimeAsync(35);await pending;vi.useRealTimers();
  vi.mocked(fetch).mockImplementation(async()=>new Response("small",{headers:{"content-length":String(9*1024*1024)}}));
  await expect(publicRead("/services/v2/spls.json",{})).rejects.toMatchObject({status:413,data:{body_unavailable:true}});
});
it("retains partial/error bodies, source identity and checksum",async()=>{
  for(const status of [206,404,429,503]){
    vi.stubGlobal("fetch",vi.fn(async()=>new Response("α failure",{status,headers:{"retry-after":"5"}})));
    await expect(publicRead("/services/v2/spls.json",{})).rejects.toMatchObject({status:status===206?502:status,data:{raw_body:"α failure",retry_after:"5",receipt:{http_status:status,bytes:10,response_sha256:expect.stringMatching(/^[a-f0-9]{64}$/)}}});
  }
});
it("retains a UTF-8 BOM and rejects invalid UTF-8",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(new Uint8Array([239,187,191,65]))));
  expect(responseText(await publicRead("/services/v2/spls.json",{}))).toBe("\uFEFFA");
  vi.mocked(fetch).mockImplementation(async()=>new Response(new Uint8Array([255])));
  expect(()=>responseText({raw:new Uint8Array([255]),source_url:"fixture",receipt:{source_url:"fixture",retrieved_at:"fixture",http_status:200,bytes:1,response_sha256:"fixture",content_type:null}})).toThrow("Invalid DailyMed UTF-8");
});
it("uses the documented version download without masking native failures",async()=>{
  const mock=vi.fn(async()=>new Response(zip({"label.xml":xml()})));vi.stubGlobal("fetch",mock);
  expect(await readArchivedSpl(setid,{expected_spl_version:"3"})).toMatchObject({archive_id:null,_dailymed:{download_selector:"setid_version"}});
  const url=new URL(String(vi.mocked(fetch).mock.calls[0][0]));expect(url.pathname).toBe("/dailymed/getFile.cfm");expect(Object.fromEntries(url.searchParams)).toEqual({type:"zip",setid,version:"3"});
  mock.mockImplementation(async()=>new Response("File not found.",{status:404}));
  await expect(readArchivedSpl(setid,{expected_spl_version:"3"})).rejects.toMatchObject({status:404,data:{raw_body:"File not found."}});
  expect(mock).toHaveBeenCalledTimes(2);
});
it.each([
  ["/rxcuis/1049502.json","/spls.json",{rxcui:"1049502"}],
  ["/ndcs/0003-0893-21.json","/spls.json",{ndc:"0003-0893-21"}],
  ["/pharmacologicclasses/N0000178375.json","/spls.json",{drug_class_code:"N0000178375"}],
  ["/pharmacologicclasses.json?class_type=EPC&class_code=N0000178375","/drugclasses.json",{class_code_type:"epc",drug_class_code:"N0000178375"}],
])("maps the legacy %s to a disclosed native list",async(path,nativePath,filters)=>{
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({data:[],metadata:{total_elements:0}})));
  const result=await createDailymedApiFetch()({method:"GET",path:path as string,params:{pagesize:2}});
  const url=new URL(String(vi.mocked(fetch).mock.calls[0][0]));
  expect(url.pathname).toBe("/dailymed/services/v2"+nativePath);expect(Object.fromEntries(url.searchParams)).toEqual({...filters as object,pagesize:"2"});
  expect(result.data).toMatchObject({_dailymed:{compatibility:{native_path:nativePath}},data:[]});
});
it.each([
  ["/rxcuis/1.json",{rxcui:"2"}], ["/ndcs.json",{ndc:"123"}], ["/rxcuis.json",{drug_name:"ignored"}],
  ["/pharmacologicclasses.json",{class_type:"CS"}], ["/spls.json?page=1",{page:2}],
])("rejects ignored/conflicting query selectors %s",async(path,params)=>{
  const mock=vi.fn();vi.stubGlobal("fetch",mock);
  await expect(createDailymedApiFetch()({method:"GET",path:path as string,params:params as Record<string,unknown>})).rejects.toThrow();expect(mock).not.toHaveBeenCalled();
});
