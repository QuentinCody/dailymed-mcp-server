import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import type { SchemaHints } from "@bio-mcp/shared/staging/schema-inference";
import { record } from "./lib/label-history";

const IDS=["setid","document_id","spl_version","archive_id","rxcui","ndc","unii","unii_code","application_number","class_code","code"];
const nativeRow=(value:unknown)=>({...(record(value)?Object.fromEntries(Object.entries(value).filter(([,item])=>item===null||typeof item!=="object").map(([key,item])=>[key,IDS.includes(key)&&item!==null&&item!==undefined?String(item):item])):{}),native_json:JSON.stringify(value)});
const context=(value:Record<string,unknown>,omitted:string[])=>({native_json:JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key])=>!omitted.includes(key))))});

export class DailymedDataDO extends RestStagingDO {
  protected getTabularData(value: unknown): unknown {
    const data=record(value)&&Array.isArray(value.content)&&record(value.structuredContent)&&"data" in value.structuredContent?value.structuredContent.data:value;
    if(!record(data))return data;
    if(typeof data.sql==="string"&&Array.isArray(data.rows))return {query_rows:data.rows.map(nativeRow)};
    if(typeof data.spl_xml==="string")return {
      spl_documents:[Object.fromEntries(Object.entries(nativeRow(data)).filter(([key])=>key!=="native_json"))],
      label_context:[context(data,["spl_xml","archive_members"])],
      ...(Array.isArray(data.archive_members)?{archive_members:data.archive_members.map(nativeRow)}:{}),
    };
    if(Array.isArray(data.candidates)&&typeof data.source_html==="string")return {
      archive_candidates:data.candidates.map(nativeRow),archive_pages:[context(data,["candidates"])],
    };
    if(Array.isArray(data.revisions)&&Array.isArray(data.pages))return {
      revisions:data.revisions.map(nativeRow),
      baseline_candidates:Array.isArray(data.baseline_candidates)?data.baseline_candidates.map(nativeRow):[],
      unknown_date_revisions:Array.isArray(data.unknown_date_revisions)?data.unknown_date_revisions.map(nativeRow):[],
      history_pages:data.pages.map((page,page_index)=>({page_index,native_json:JSON.stringify(page)})),
      timeline_context:[context(data,["revisions","baseline_candidates","unknown_date_revisions","pages"])],
    };
    if(record(data.data)&&Array.isArray(data.data.history))return {
      history:data.data.history.map(nativeRow),label_context:[context(data,[])],
    };
    if(Array.isArray(data.data)){
      return labelListTables(data, data.data);
    }
    return data;
  }
  protected getSchemaHints(): SchemaHints {return {columnTypes:Object.fromEntries([...IDS,"native_json","spl_xml"].map(name=>[name,"TEXT"]))};}
}

function labelListTables(data: Record<string, unknown>, values: unknown[]) {
  const first=values[0];
  const table = labelTableName(first);
  return {[table]:values.map(nativeRow),response_context:[context(data,["data"])]};
}

function labelTableName(first: unknown): string {
  if (!record(first)) return "observations";
  if ("ndc" in first) return "ndcs";
  if ("rxcui" in first) return "rxcuis";
  if ("setid" in first) return "spls";
  if ("drug_name" in first) return "drugnames";
  if ("unii" in first || "unii_code" in first) return "uniis";
  if ("application_number" in first) return "application_numbers";
  if ("codingSystem" in first) return "drugclasses";
  return "observations";
}
