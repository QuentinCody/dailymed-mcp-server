import {fail} from "./label-history";
export function requestParts(path: string, supplied: Record<string, unknown> = {}) {
  if (!path.startsWith("/") || path.startsWith("//") || /[#\\]/.test(path) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(path.split("?")[0])) fail("Expected a relative DailyMed path");
  const url = new URL(path,"https://dailymed.invalid");
  const params = {...supplied};
  for (const [key,value] of url.searchParams) {
    if (Object.prototype.hasOwnProperty.call(params,key)) fail(`Duplicate DailyMed query parameter: ${key}`);
    params[key]=value;
  }
  return {path:url.pathname,params};
}
