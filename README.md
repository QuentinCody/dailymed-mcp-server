# dailymed-mcp-server

MCP server wrapping the NLM DailyMed REST API v2 — authoritative FDA Structured Product Labeling (SPL). Use this when you need full SPL XML, boxed-warning verbatim text, historical label versions, or labels missing from openFDA. Port 8859.

Upstream docs: <https://dailymed.nlm.nih.gov/dailymed/app-support-web-services.cfm>
Base URL: `https://dailymed.nlm.nih.gov/dailymed/services/v2`

Code Mode tools (no hand-built tools):

- `dailymed_search` — catalog discovery (13 endpoints across spls, rxcuis, ndcs, applicationnumbers, drugnames, uniis, classes)
- `dailymed_execute` — V8 isolate with `api.get()` / `api.post()` and DOMParser-able XML output
- `dailymed_query_data` — SQL against staged SPL XML / list data (full XML stored as `spl_xml` TEXT)
- `dailymed_get_schema` — inspect staged tables

Example (via `dailymed_search` → `dailymed_execute`):

```js
const list = await api.get('/spls.json', { drug_name: 'ibuprofen', pagesize: 25 });
return list.data;
```
