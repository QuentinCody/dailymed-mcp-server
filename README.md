# dailymed-mcp-server

MCP server wrapping the NLM DailyMed REST API v2 — authoritative FDA Structured Product Labeling (SPL). Use this when you need full SPL XML, boxed-warning verbatim text, historical label versions, or labels missing from openFDA. Port 8859.

Upstream docs: <https://dailymed.nlm.nih.gov/dailymed/app-support-web-services.cfm>
Base URL: `https://dailymed.nlm.nih.gov/dailymed/services/v2`

Code Mode tools (no hand-built tools):

- `dailymed_search` — catalog discovery for native resources, temporal helpers and explicit legacy aliases
- `dailymed_execute` — V8 isolate with read-only `api.get()` and complete SPL XML output
- `dailymed_query_data` — SQL against staged SPL XML / list data (full XML stored as `spl_xml` TEXT)
- `dailymed_get_schema` — inspect staged tables

Example (via `dailymed_search` → `dailymed_execute`):

```js
const list = await api.get('/spls.json', { drug_name: 'ibuprofen', pagesize: 25 });
return list.data;
```

## Dated label comparisons (September 2026 review)

`GET /labels/{setid}/timeline` is a **local helper**, backed by DailyMed's existing
`/spls/{setid}/history.json` service. Provide inclusive `since` and `until` dates
(`YYYY-MM-DD`), optionally `max_pages` (default 5, maximum 10). It retains native
pages, set IDs, revision numbers and original publication dates. It fetches at
most 100 records per page, with a combined 8 MiB limit and 50-second deadline.

The result distinguishes retrieved-history completeness from date-selection
completeness. Unknown dates remain in `unknown_date_revisions`; hitting the page
cap returns `next_page` and marks the result incomplete. Baseline candidates are
only returned after complete retrieval with known dates; several versions on the
same publication date remain separate candidates. The helper checks observed
`db_published_date` and total count across pages, but does not claim an atomic
snapshot. `expected_db_published_date` optionally checks an exact previously
observed raw value; it does not retrieve an old database snapshot.

Current `/spls/{setid}.xml` returns the complete XML plus direct HL7 document
`setid`, `document_id`, `spl_version`, raw `effective_time`, original-byte SHA-256,
source URL and retrieval time. Optional `expected_spl_version` and
`expected_xml_sha256` are **local mismatch guards**, not historical selectors.
An older requested version produces an error if it is no longer current. The
identity scanner checks nesting/namespaces; it is not full FDA SPL schema
validation. Responses are bounded to 8 MiB and use fixed-host, read-only requests.

DailyMed publication date, SPL `effectiveTime`, retrieval time and FDA approval
date are different concepts. A revision date alone does not establish changed
label text, a new warning, or clinical significance. Published-date search is a
current-label candidate search, not a complete historical change log.

`GET /labels/{setid}/archive` retrieves a historical ZIP and verifies its XML
against the exact requested set ID and required `expected_spl_version` string.
By default it uses the [documented ZIP download](https://dailymed.nlm.nih.gov/dailymed/app-support-web-services.cfm)
`getFile.cfm?type=zip&setid=...&version=...`. Optional `archive_id` selects an
observed `getArchivalFile.cfm` download instead. Neither is a historical selector
on the current REST XML endpoint. There is no automatic fallback: on October 4,
ELIQUIS version 29 worked by either route with identical ZIP bytes, while inactive
EDECRIN versions 2/3 returned native 404 by version but worked by archive ID.

`GET /labels/{setid}/archives?through=YYYY-MM-DD&page=1` discovers one native
[Labeling Archives](https://dailymed.nlm.nih.gov/dailymed/archives/index.cfm) page,
retaining its full HTML, checksum, candidate IDs and continuation. The date is an
inclusive filter; results include older revisions, not a unique as-of document.
Listing identity remains unverified until the XML is downloaded and checked.
The adapter fails explicitly if the website's structure changes.

Downloads are bounded to 8 MiB, require one XML member, and verify ZIP structure,
member CRC32 and setid/version. Optional `expected_xml_sha256` and
`expected_archive_sha256` check original bytes. Full XML and member metadata remain
recoverable; images are listed but not extracted. XML effective time is distinct
from publication time; join history by exact setid/version. For example:

```js
return await api.get('/labels/e9481622-7cc6-418a-acb6-c5450daae9b0/archive', {
  expected_spl_version: '29'
});
```

For two downloaded and verified revisions:

```bash
python3 servers/dailymed-mcp-server/scripts/compare_spl.py \
  before.xml after.xml \
  --before-sha256 <expected-before-sha256> \
  --after-sha256 <expected-after-sha256>
```

The offline tool requires matching set IDs and increasing versions, rejects
DTD/entity declarations, and bounds input/tree/expanded-section sizes. It emits
JSON to stdout with document hashes, version/date references, and section groups
keyed by code-system/code. Full normalized text is retained; canonical XML hashes
also detect markup changes. Repeated codes retain ordered arrays without guessed
pairing. Nested sections also appear within parent text. No automated clinical
interpretation is made. Retain archive URLs and DailyMed publication dates with
the input-file manifest; these are not independently established by local files.

Both MCP tool aliases are registered and carry query/result citations. Whole MCP
responses above 30 KiB stage, including composed results, SQL, schema and errors;
retain `__staged` handles and inspect `get_schema`/the staging envelope for actual
lossless tables. `payloads` retains the complete original artifact. XML projects
to `spl_documents`, archive listings to `archive_candidates`/`archive_pages`, and
timelines to revisions, baseline candidates and native history pages. Identifier
columns are TEXT; `native_json` retains original scalar types and nested fields.
Native response-byte hashes are separate from canonical MCP result hashes.
Public reads have independent header/body deadlines and preserve native failure
evidence; partial or unavailable bodies are not successful complete reads.
Do not use `DOMParser` inside Code Mode or infer missing warnings from regex.

Legacy `/rxcuis/{id}.json`, `/ndcs/{id}.json` and
`/pharmacologicclasses/{code}.json` now explicitly alias filtered `/spls.json`
lists. They are not native detail endpoints. `/pharmacologicclasses.json` aliases
the native `/drugclasses.json`; legacy class-code/type names are translated.
Unsupported filters on NDC/RxCUI lists are rejected instead of silently ignored.
On October 4, unfiltered drug-class paging worked but documented drug-class
filters returned native HTTP 500, even with the observed coding system; these
errors remain visible. Label joins via `/spls.json` worked with code plus the
observed `codingSystem` (`2.16.840.1.113883.6.345`), which differs from the older
documented default. Native label NDC, media and packaging resources are cataloged.

Sources: [history contract](https://dailymed.nlm.nih.gov/dailymed/webservices-help/v2/spls_setid_history_api.cfm),
[current XML contract](https://dailymed.nlm.nih.gov/dailymed/webservices-help/v2/spls_setid_api.cfm),
[dated list filters](https://dailymed.nlm.nih.gov/dailymed/webservices-help/v2/spls_api.cfm),
[FDA document identity/date rules](https://www.fda.gov/media/84201/download),
[API history](https://dailymed.nlm.nih.gov/dailymed/webservices-help/v2/api-history.cfm).
No new 2026 API operation was established by this review. October 4 local Worker
acceptance recovered current and historical native XML byte-for-byte, archive
listing HTML, history pagination, native errors and SQL identifiers. Offline
comparison of MCP-recovered EDECRIN versions 2→3 found 24 section groups (six
canonical changes; one text change); ELIQUIS 29→30 found 33 groups (27 canonical
changes; 23 text changes). These counts do not assess clinical significance.
See the [implementation tracker](../../docs/plans/2026-09-26-upstream-api-implementation.md)
and `scratch/2026-10-04-dailymed/verification.json` for gates and receipts.
Deployment remains pending.

<!-- license-and-data-terms:start -->
## License and data terms

The code in this repository is licensed under the Apache License 2.0 (see `LICENSE`).
If you use it in your work, please cite it (see `CITATION.cff`). Citation is requested, not required.

The license covers the code only. Data that this server returns comes from DailyMed and stays under the terms of that source: US public domain labels.
You are responsible for your use of the data under those terms.
<!-- license-and-data-terms:end -->
