import {fail} from "./label-history";

/** Legacy catalog spellings are local aliases, never claimed as native API resources. */
export function compatibilityPath(path:string,params:Record<string,unknown>) {
  const alias=(old:string,key:string,value?:unknown)=>{
    const mapped=value===undefined?params[old]:value;
    if(mapped===undefined)return;
    if(params[key]!==undefined && String(params[key])!==String(mapped))fail(`Conflicting ${key} filter`);
    params[key]=mapped;if(old!==key)delete params[old];
  };
  const detail=/^\/(rxcuis|ndcs|pharmacologicclasses)\/([a-zA-Z\d_-]+)\.json$/.exec(path);
  if(detail){
    const key=detail[1]==="rxcuis"?"rxcui":detail[1]==="ndcs"?"ndc":"drug_class_code";
    alias(key,key,detail[2]);return {path:"/spls.json",params,compatibility:{requested_path:path,native_path:"/spls.json",meaning:"One page of labels matching the explicit identifier; not a concept/class detail record."}};
  }
  if(path==="/pharmacologicclasses.json"){
    alias("class_code","drug_class_code");
    if(params.class_type!==undefined){
      const type=String(params.class_type).toLowerCase();
      if(!["epc","moa","pe","ci","chemical/ingredient","all"].includes(type))fail("Unsupported legacy class_type; use native class_code_type: epc, moa, pe, ci or all");
      alias("class_type","class_code_type",type);
    }
    return {path:"/drugclasses.json",params,compatibility:{requested_path:path,native_path:"/drugclasses.json",meaning:"Local compatibility alias for the native drug-class list."}};
  }
  if(path==="/uniis.json" && params.unii!==undefined)alias("unii","unii_code");
  return {path,params};
}
