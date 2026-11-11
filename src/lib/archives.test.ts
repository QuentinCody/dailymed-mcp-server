import {afterEach,expect,it,vi} from "vitest";
import {archiveListing,readArchivedSpl} from "./archives";
import {crc32,zipMember,zipMembers} from "./archive-zip";
import {setid,xml,zip} from "./archive-fixture";
import native from "./native-archive.fixture.json";
import {createDailymedApiFetch} from "./api-adapter";
afterEach(()=>vi.unstubAllGlobals());
const active="e9481622-7cc6-418a-acb6-c5450daae9b0";
it("parses observed archive candidates without inventing set IDs, as-of uniqueness or full coverage",()=>{
  const result=archiveListing(native.html,active,"2025-05-01",1);
  expect(result.candidates.map(row=>[row.archive_id,row.spl_version,row.publication_date_iso])).toEqual([
    ["702293","29","2023-01-30"],["635883","28","2022-02-21"],["600406","27","2021-10-01"],["573882","26","2021-04-26"],["570795","25","2021-04-09"]]);
  expect(result).toMatchObject({page:1,total_pages:6,next_page:2,source_html:native.html,_dailymed:{complete:false,document_identity_verified:false}});
  expect(result.candidates.every(row=>row.document_identity_verified===false)).toBe(true);
  expect(result.candidates[0].title_html).toContain("ELIQUIS");
});
it.each([
  native.html.replace('archive_id=702293','archive_id=1'),
  native.html.replace('Version: <span>29','Version: <span>unknown'),
  native.html.replaceAll('page=2','page=9'),
  native.html.replaceAll('value="1"','value="2"'),
  native.html.replaceAll('Jan 30, 2023','Jan 30, 2026'),
  '<html>temporary error</html>',
])("rejects inconsistent/unrecognized HTML instead of reporting empty archives %#",html=>{
  expect(()=>archiveListing(html,active,"2025-05-01",1)).toThrow();
});
it("requires the native empty-state marker",()=>{
  expect(archiveListing('<form action="/dailymed/archives/index.cfm"><div class="no-drugs-found">No Drug Package Labels found.</div></form>',active,"2025-05-01",1)).toMatchObject({candidates:[],total_pages:0,next_page:null});
});
it("checks XML identity and byte hashes independently of listing metadata",async()=>{
  const document=xml();const bytes=zip({"label.xml":document,"image.jpg":"unextracted"});
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(bytes,{headers:{"content-type":"application/zip"}})));
  const result=await readArchivedSpl(setid,{archive_id:"89126",expected_spl_version:"3"});
  expect(result).toMatchObject({spl_xml:document,setid,spl_version:"3",effective_time:"20120920",archive_id:"89126",_dailymed:{publication_date:null,historical_snapshot:true,member_crc32_verified:true}});
  expect(result.archive_members.map(row=>row.name)).toEqual(["label.xml","image.jpg"]);
  expect(await readArchivedSpl(setid,{archive_id:"89126",expected_spl_version:"3",expected_xml_sha256:result._dailymed.xml_sha256,expected_archive_sha256:result._dailymed.archive_sha256})).toMatchObject({spl_xml:document});
  for(const options of [{expected_spl_version:"2"},{expected_xml_sha256:"0".repeat(64)},{expected_archive_sha256:"0".repeat(64)}])await expect(readArchivedSpl(setid,{archive_id:"89126",expected_spl_version:"3",...options})).rejects.toMatchObject({status:409,data:{receipt:{response_sha256:result._dailymed.archive_sha256}}});
  await expect(readArchivedSpl(active,{archive_id:"89126",expected_spl_version:"3"})).rejects.toMatchObject({status:409,data:{observed_xml:{spl_xml:document}}});
});
it.each<Record<string,string>>([{"a.xml":xml(),"b.xml":xml()},{"image.jpg":"not XML"}])("rejects ambiguous or missing XML members %#",async entries=>{
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(zip(entries))));
  await expect(readArchivedSpl(setid,{archive_id:"89126",expected_spl_version:"3"})).rejects.toMatchObject({status:502});
});
it("checks known CRC32 and detects a corrupted directory CRC",async()=>{
  expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  const bytes=zip({"a.xml":xml()});const member=zipMembers(bytes)[0];member.crc32^=1;
  await expect(zipMember(bytes,member)).rejects.toThrow("CRC");
});
it.each([new Uint8Array(),zip({"../label.xml":xml()}),zip({"folder/label.xml":xml()})])("rejects incomplete or unsupported ZIP layouts %#",bytes=>{
  expect(()=>zipMembers(bytes)).toThrow();
});
it("preserves native pages and byte receipts while separating selected and baseline versions",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json(native.history)));
  const result=await createDailymedApiFetch()({method:"GET",path:`/labels/${active}/timeline`,params:{since:"2025-01-01",until:"2025-05-31"}});
  expect(result.data).toMatchObject({revisions:[{spl_version:30,publication_date_iso:"2025-05-05"}],baseline_candidates:[{spl_version:29,publication_date_iso:"2023-01-30"}],pages:[native.history],page_receipts:[{response_sha256:expect.stringMatching(/^[a-f0-9]{64}$/)}]});
  expect(result.completeness).toMatchObject({complete:false,returned:1});
});
