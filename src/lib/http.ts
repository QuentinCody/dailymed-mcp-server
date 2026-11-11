import {fail} from "./label-history";
import {publicRead, responseText} from "./read";

const safePath = /^\/(?:[a-z]+\.(?:json|xml)|(?:spls|rxcuis|ndcs|pharmacologicclasses)\/[a-zA-Z\d_-]+(?:\/(?:history|ndcs|packaging|media))?\.(?:json|xml))$/;
export async function dailymedRead(path: string, params: Record<string, unknown>, deadline = Date.now() + 45_000) {
  if (!safePath.test(path)) fail("Unsupported DailyMed path");
  const filters:Record<string,string[]>={rxcuis:["rxcui","rxstring","rxtty"],ndcs:[],drugclasses:["drug_class_code","drug_class_coding_system","class_code_type","class_name","unii_code"],uniis:["active_moiety","drug_class_code","drug_class_coding_system","rxcui","unii_code"]};
  const resource=/^\/([a-z]+)\.(?:json|xml)$/.exec(path)?.[1];
  if(resource && filters[resource])for(const key of Object.keys(params))if(!["page","pagesize",...filters[resource]].includes(key))fail(`Unsupported ${resource} filter: ${key}; use documented filters or /spls.json for label lookup`);
  const result = await publicRead("/services/v2" + path,params,deadline,path.endsWith(".xml")?"*/*":"application/json");
  return {...result,text:responseText(result)};
}
