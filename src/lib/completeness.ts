import type { Completeness } from "@bio-mcp/shared";
import { record } from "./label-history";
const scoped = (returned: number, detail: string): Completeness => ({complete:false,returned,
  truncation:{reason:"unknown",detail,remedy:"Retain exact label identity, native paging, date semantics and source receipts. A publication revision does not prove a clinical change or exhaustive date-specific label coverage."}});
function direct(value: unknown): Completeness | undefined {
  if (Array.isArray(value)) return scoped(value.length,"One DailyMed selection, not complete label or historical coverage.");
  if (!record(value)) return undefined;
  if (typeof value.spl_xml==="string") return scoped(1,"One complete retrieved XML representation; label history, linked images and clinical significance are separate.");
  if (Array.isArray(value.candidates) && typeof value.source_html==="string") return scoped(value.candidates.length,"One archive listing page; candidates require XML identity verification.");
  if (Array.isArray(value.revisions) && record(value._dailymed)) return scoped(value.revisions.length,"Selected publication revisions. _dailymed separately reports retrieved-history/date-selection completeness; content changes are unproven.");
  const rows=Array.isArray(value.data)?value.data:record(value.data)&&Array.isArray(value.data.history)?value.data.history:undefined;
  if (rows && record(value.metadata)) {
    const total=Number(value.metadata.total_elements);
    return {...scoped(rows.length,"One native DailyMed response page; preserve next_page and database publication date."),
      ...(Number.isSafeInteger(total)&&total>=rows.length?{total_available:total}:{})};
  }
  return undefined;
}
export function dailymedCompleteness(value: unknown): Completeness | undefined {
  const queue=[value];const found:Completeness[]=[];
  while(queue.length){const item=queue.pop();if(!item||typeof item!=="object")continue;
    if(record(item)&&(item.__staged===true||item.__api_error===true||item.__stage_error===true)){
      if(record(item._staging)&&record(item._staging.completeness)&&item._staging.completeness.complete===false)found.push({...item._staging.completeness,complete:false});
      continue;
    }
    const scope=direct(item);if(scope)found.push(scope);else queue.push(...Object.values(item));
  }
  return found.length<2?found[0]:{complete:false,truncation:{reason:"unknown",detail:"Composed DailyMed observations have independent paging, document and date scopes.",remedy:"Keep each source observation separate; do not sum unrelated counts or infer clinical changes."}};
}
