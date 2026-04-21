import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";

/**
 * DailyMed REST API catalog (NLM Structured Product Labeling service, v2).
 *
 * DailyMed is NLM's authoritative repository for FDA SPL content. Unlike
 * openFDA (which re-publishes SPL metadata as flattened JSON), DailyMed
 * serves the full SPL XML including LOINC-sectioned content — boxed
 * warnings, indications, pediatric use, carcinogenesis — verbatim, plus
 * complete supersession history and labels not yet flowed into openFDA.
 *
 * Response formats:
 *   - `.json` endpoints → JSON summary records (parsed to objects)
 *   - `.xml`  endpoints → full SPL XML (kept as TEXT; Code Mode parses
 *     with `DOMParser` in the V8 isolate)
 *
 * See `docs/plans/2026-04-20-biomni-gap-closure-sync-rest.md` §5.5.
 */
export const dailymedCatalog: ApiCatalog = {
    name: "DailyMed (NLM Structured Product Labels)",
    baseUrl: "https://dailymed.nlm.nih.gov/dailymed/services/v2",
    version: "v2",
    auth: "none",
    endpointCount: 13,
    notes:
        "Use openfda for quick label-metadata search (brand/generic/pharm class); use dailymed when you need full SPL XML, boxed-warning verbatim text, historical label versions, or labels missing from openFDA.\n" +
        "\n" +
        "Response format rules:\n" +
        "- Endpoints ending in .json return paginated JSON: { data: [...], metadata: { total_elements, total_pages, current_page, next_page_url, previous_page_url } }.\n" +
        "- Endpoints ending in .xml return the full SPL XML as a TEXT string in the `spl_xml` field of the response data. Parse with `new DOMParser().parseFromString(data.spl_xml, 'application/xml')` inside Code Mode; extract LOINC-sectioned content (boxed warning LOINC 34066-1, indications 34067-9, pediatric use 34081-0, etc.) yourself.\n" +
        "- Full SPL XML is almost always >30 KB and therefore always stages to the DO — retrieve via `dailymed_query_data` with a SELECT on the `spl_documents` table.\n" +
        "\n" +
        "Pagination: all .json list endpoints accept `page` (1-based) and `pagesize` (default 100, max 100) query params.\n" +
        "\n" +
        "Stable identifiers: `setid` identifies a label across all its versions; `spl_version` increments per revision. Use `/spls/{setid}/history.json` to walk the supersession chain.",
    endpoints: [
        {
            method: "GET",
            path: "/spls.json",
            summary:
                "Paginated list of SPLs. Filter by drug name, RxCUI, NDC, labeler, setid, or FDA application number.",
            category: "spls",
            queryParams: [
                {
                    name: "drug_name",
                    type: "string",
                    required: false,
                    description: "Filter by drug name (partial match, case-insensitive)",
                },
                {
                    name: "rxcui",
                    type: "string",
                    required: false,
                    description: "Filter by RxNorm Concept Unique Identifier",
                },
                {
                    name: "ndc",
                    type: "string",
                    required: false,
                    description: "Filter by National Drug Code (with or without hyphens)",
                },
                {
                    name: "labeler",
                    type: "string",
                    required: false,
                    description: "Filter by labeler / manufacturer name",
                },
                {
                    name: "setid",
                    type: "string",
                    required: false,
                    description: "Filter by SPL setid (stable identifier across versions)",
                },
                {
                    name: "application_number",
                    type: "string",
                    required: false,
                    description: "Filter by FDA application number (e.g. NDA021436)",
                },
                {
                    name: "published_date",
                    type: "string",
                    required: false,
                    description: "Filter by published date (YYYY-MM-DD)",
                },
                {
                    name: "published_date_comparison",
                    type: "string",
                    required: false,
                    description: "Comparison operator for published_date",
                    enum: ["lt", "lte", "eq", "gte", "gt"],
                },
                {
                    name: "page",
                    type: "number",
                    required: false,
                    description: "1-based page number",
                    default: 1,
                },
                {
                    name: "pagesize",
                    type: "number",
                    required: false,
                    description: "Results per page (max 100)",
                    default: 100,
                },
            ],
            example:
                "const { data } = await api.get('/spls.json', { drug_name: 'ibuprofen', pagesize: 25 });",
            featured: true,
        },
        {
            method: "GET",
            path: "/spls/{setid}.json",
            summary:
                "Lightweight JSON summary for one SPL (title, labeler, published date, spl_version, packaging/marketing info).",
            category: "spls",
            pathParams: [
                {
                    name: "setid",
                    type: "string",
                    required: true,
                    description: "SPL setid (stable UUID identifier)",
                },
            ],
        },
        {
            method: "GET",
            path: "/spls/{setid}.xml",
            summary:
                "FULL SPL XML — the differentiator vs openFDA. Contains LOINC-sectioned content (boxed warning 34066-1, indications 34067-9, dosage 34068-7, pediatric use 34081-0, pregnancy 42228-3, etc.) verbatim. Always staged (typically 50 KB – 5 MB); retrieve the XML text with `dailymed_query_data` on the `spl_documents` table. Parse client-side with `DOMParser` in the V8 isolate.",
            category: "spls",
            pathParams: [
                {
                    name: "setid",
                    type: "string",
                    required: true,
                    description: "SPL setid (stable UUID identifier)",
                },
            ],
            usageHint:
                "The response envelope exposes `{ content_type: 'application/xml', spl_xml, setid, length }`. Stage always fires; query the `spl_documents` table and parse the `spl_xml` column with DOMParser to walk LOINC <section> nodes.",
            featured: true,
        },
        {
            method: "GET",
            path: "/spls/{setid}/history.json",
            summary:
                "Version / supersession history for one SPL — returns every spl_version with published_date, allowing reconstruction of the label revision timeline.",
            category: "spls",
            pathParams: [
                {
                    name: "setid",
                    type: "string",
                    required: true,
                    description: "SPL setid (stable UUID identifier)",
                },
            ],
        },
        {
            method: "GET",
            path: "/rxcuis.json",
            summary: "Paginated RxCUI list. Filter by RxNorm concept, drug name, or NDC.",
            category: "rxcuis",
            queryParams: [
                {
                    name: "rxcui",
                    type: "string",
                    required: false,
                    description: "Filter by specific RxCUI",
                },
                {
                    name: "drug_name",
                    type: "string",
                    required: false,
                    description: "Filter by drug name",
                },
                {
                    name: "rxstring",
                    type: "string",
                    required: false,
                    description: "Filter by RxNorm string term",
                },
                {
                    name: "rxtty",
                    type: "string",
                    required: false,
                    description:
                        "Filter by RxNorm term type (SCD, SBD, GPCK, BPCK, IN, PIN, MIN, BN, …)",
                },
                {
                    name: "page",
                    type: "number",
                    required: false,
                    description: "1-based page number",
                },
                {
                    name: "pagesize",
                    type: "number",
                    required: false,
                    description: "Results per page (max 100)",
                },
            ],
        },
        {
            method: "GET",
            path: "/rxcuis/{rxcui}.json",
            summary:
                "SPLs linked to one RxCUI — map from RxNorm concept to every label that references it.",
            category: "rxcuis",
            pathParams: [
                {
                    name: "rxcui",
                    type: "string",
                    required: true,
                    description: "RxNorm Concept Unique Identifier",
                },
            ],
        },
        {
            method: "GET",
            path: "/ndcs.json",
            summary: "Paginated NDC list. Filter by NDC, drug name, or labeler.",
            category: "ndcs",
            queryParams: [
                {
                    name: "ndc",
                    type: "string",
                    required: false,
                    description: "Filter by National Drug Code (hyphenated or not)",
                },
                {
                    name: "drug_name",
                    type: "string",
                    required: false,
                    description: "Filter by drug name",
                },
                {
                    name: "labeler",
                    type: "string",
                    required: false,
                    description: "Filter by labeler / manufacturer name",
                },
                {
                    name: "page",
                    type: "number",
                    required: false,
                    description: "1-based page number",
                },
                {
                    name: "pagesize",
                    type: "number",
                    required: false,
                    description: "Results per page (max 100)",
                },
            ],
        },
        {
            method: "GET",
            path: "/ndcs/{ndc}.json",
            summary: "SPL(s) linked to one NDC — accepts hyphenated or stripped NDC.",
            category: "ndcs",
            pathParams: [
                {
                    name: "ndc",
                    type: "string",
                    required: true,
                    description: "National Drug Code",
                },
            ],
        },
        {
            method: "GET",
            path: "/applicationnumbers.json",
            summary:
                "Paginated list of FDA application numbers (NDA, ANDA, BLA, …) appearing in DailyMed SPLs.",
            category: "applicationnumbers",
            queryParams: [
                {
                    name: "application_number",
                    type: "string",
                    required: false,
                    description: "Filter by application number prefix",
                },
                {
                    name: "page",
                    type: "number",
                    required: false,
                    description: "1-based page number",
                },
                {
                    name: "pagesize",
                    type: "number",
                    required: false,
                    description: "Results per page (max 100)",
                },
            ],
        },
        {
            method: "GET",
            path: "/drugnames.json",
            summary:
                "Paginated list of drug names referenced in DailyMed. Serves as a typeahead / autocomplete source.",
            category: "drugnames",
            queryParams: [
                {
                    name: "drug_name",
                    type: "string",
                    required: false,
                    description: "Filter by drug name prefix (case-insensitive)",
                },
                {
                    name: "name_type",
                    type: "string",
                    required: false,
                    description: "Restrict by brand or generic",
                    enum: ["brand", "generic", "both"],
                },
                {
                    name: "manufacturer",
                    type: "string",
                    required: false,
                    description: "Filter by manufacturer",
                },
                {
                    name: "page",
                    type: "number",
                    required: false,
                    description: "1-based page number",
                },
                {
                    name: "pagesize",
                    type: "number",
                    required: false,
                    description: "Results per page (max 100)",
                },
            ],
        },
        {
            method: "GET",
            path: "/uniis.json",
            summary:
                "Paginated UNII list — FDA Unique Ingredient Identifiers used as active/inactive ingredients in SPLs.",
            category: "uniis",
            queryParams: [
                {
                    name: "unii",
                    type: "string",
                    required: false,
                    description: "Filter by specific UNII",
                },
                {
                    name: "rxcui",
                    type: "string",
                    required: false,
                    description: "Filter by linked RxCUI",
                },
                {
                    name: "page",
                    type: "number",
                    required: false,
                    description: "1-based page number",
                },
                {
                    name: "pagesize",
                    type: "number",
                    required: false,
                    description: "Results per page (max 100)",
                },
            ],
        },
        {
            method: "GET",
            path: "/pharmacologicclasses.json",
            summary:
                "Paginated list of pharmacologic classes (EPC, MoA, PE, CS) referenced in SPLs — useful for finding all labels in a therapeutic class.",
            category: "classes",
            queryParams: [
                {
                    name: "class_name",
                    type: "string",
                    required: false,
                    description: "Filter by class name substring",
                },
                {
                    name: "class_code",
                    type: "string",
                    required: false,
                    description: "Filter by FDA class code",
                },
                {
                    name: "class_type",
                    type: "string",
                    required: false,
                    description: "Filter by class type",
                    enum: ["EPC", "MoA", "PE", "CS"],
                },
                {
                    name: "page",
                    type: "number",
                    required: false,
                    description: "1-based page number",
                },
                {
                    name: "pagesize",
                    type: "number",
                    required: false,
                    description: "Results per page (max 100)",
                },
            ],
        },
        {
            method: "GET",
            path: "/pharmacologicclasses/{class_code}.json",
            summary:
                "Detail for one pharmacologic class, including the SPLs that reference it. Complements the listing endpoint for drill-down.",
            category: "classes",
            pathParams: [
                {
                    name: "class_code",
                    type: "string",
                    required: true,
                    description: "FDA pharmacologic class code",
                },
            ],
        },
    ],
    workflows: [
        {
            title: "Full SPL XML retrieval with boxed-warning extraction",
            description:
                "Find all SPLs for a drug by name, pick one, stage the full XML, and extract the boxed-warning section (LOINC 34066-1) client-side.",
            keywords: [
                "spl",
                "xml",
                "boxed warning",
                "loinc",
                "label",
                "prescribing information",
            ],
            code: `
// 1. List candidate SPLs
const list = await api.get('/spls.json', { drug_name: 'ibuprofen', pagesize: 5 });
const spls = list.data?.data || list.data || [];
if (!spls.length) return { message: 'No SPLs found' };
const setid = spls[0].setid;

// 2. Fetch the full SPL XML (always stages — check _staging in the response)
const xmlResp = await api.get(\`/spls/\${setid}.xml\`);
// xmlResp.data is { content_type: 'application/xml', spl_xml, setid, length }
// If staged, retrieve via dailymed_query_data: SELECT spl_xml FROM spl_documents WHERE setid = ?

// 3. Parse in the V8 isolate. DOMParser is not built-in; use a regex for the
// boxed-warning LOINC block, or surface the XML to the caller for richer parsing.
const xml = xmlResp.data.spl_xml;
const boxedWarning = /<section[^>]*>\\s*<code[^>]*code="34066-1"[^>]*\\/>([\\s\\S]*?)<\\/section>/i.exec(xml);
return { setid, boxed_warning_snippet: boxedWarning ? boxedWarning[0].slice(0, 2000) : null };
`.trim(),
        },
        {
            title: "RxCUI → list of label setids",
            description:
                "Map from an RxNorm concept to every DailyMed SPL that references it.",
            keywords: ["rxcui", "rxnorm", "label", "crosswalk"],
            code: `
const r = await api.get('/rxcuis/1049502.json');
return r.data;
`.trim(),
        },
        {
            title: "Walk supersession history",
            description:
                "List every version of one label to reconstruct the revision timeline.",
            keywords: ["history", "version", "supersession", "timeline", "revision"],
            code: `
const setid = '595f437d-2729-40bb-9c62-c8ece1f82780';
const h = await api.get(\`/spls/\${setid}/history.json\`);
return h.data;
`.trim(),
        },
    ],
};
