import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";

/** DailyMed REST v2. Publication history is paginated; current XML is not an archive selector. */
export const dailymedCatalog: ApiCatalog = {
    name: "DailyMed (NLM Structured Product Labels)",
    baseUrl: "https://dailymed.nlm.nih.gov/dailymed/services/v2",
    version: "v2",
    auth: "none",
    endpointCount: 20,
    notes:
        "Use openfda for quick label-metadata search; use dailymed for full SPL XML, boxed-warning verbatim text, historical label versions and publication history. " +
        "JSON lists preserve data and metadata; history has data.history and data.spl. page is 1-based, pagesize <=100. " +
        "Current SPL XML returns spl_xml plus document_id, setid, spl_version, raw effective_time and byte SHA-256. expected_spl_version/expected_xml_sha256 are local guards, not archive selectors. " +
        "Responses >30 KiB stage. If api.get returns __staged, retain its handle; inspect get_schema and the staging envelope for lossless tables instead of assuming spl_documents exists. " +
        "DOMParser is not built into Code Mode. Do not use regex to infer absent clinical sections or silently truncate warnings. " +
        "The local timeline helper preserves native history pages and unknown dates, bounds pagination, and selects publication revisions in an inclusive interval. " +
        "DailyMed publication date, SPL effectiveTime, retrieval time and FDA approval date are different. Revision dates do not prove a clinical/safety change. " +
        "Local /labels/{setid}/archives reads one native archive-listing page through a date; /labels/{setid}/archive reads the documented setid/version ZIP or an explicit archive ID and verifies XML identity and optional hashes. The documented version route can return 404 for inactive labels whose archive-ID downloads still work. " +
        "Legacy /rxcuis/{id}.json, /ndcs/{id}.json and /pharmacologicclasses/{code}.json are local aliases for filtered /spls.json lists; /pharmacologicclasses.json aliases /drugclasses.json. These are not native detail resources. " +
        "October 2026 native /drugclasses filters returned HTTP 500 while unfiltered paging worked. Retain native errors; do not silently drop filters. For /spls drug-class joins, pass the codingSystem observed with each code; current responses used 2.16.840.1.113883.6.345, distinct from the older documented default. " +
        "No new 2026 API operation was verified: dated search was documented in 2015 and history in 2014.",
    endpoints: [
        {method:"GET",path:"/labels/{setid}/archives",category:"archives",featured:true,
            summary:"Discover one native archive page through a publication date, retaining original HTML and retrieval checksum.",
            description:"Local view of the DailyMed Labeling Archives website. Results are candidates, not a unique as-of label; XML identity must be checked separately. Explicit through avoids the website's current-year default. Returns five candidates per page, native continuation and source_html; large pages stage with archive_candidates and archive_pages tables.",
            pathParams:[{name:"setid",type:"string",required:true,description:"Exact SPL set UUID; listing query context, not verified document identity."}],
            queryParams:[{name:"through",type:"string",required:true,description:"Inclusive native archive-date filter YYYY-MM-DD; observed site returns older revisions as well."},{name:"page",type:"number",required:false,description:"Positive page number, default 1. One page per request; inspect native continuation."}],
            example:"return await api.get('/labels/e9481622-7cc6-418a-acb6-c5450daae9b0/archives',{through:'2025-05-01',page:1});"},
        {method:"GET",path:"/labels/{setid}/archive",category:"archives",featured:true,
            summary:"Retrieve a historical SPL by exact setid/version or observed archive ID, verifying ZIP CRC32 and original XML/ZIP SHA-256.",
            description:"Local adapter reads documented getFile.cfm?type=zip&setid=...&version=... by default. Optional archive_id uses getArchivalFile.cfm instead; this is needed for some inactive labels where the version route returns 404. No automatic fallback. Accepts a complete <=8 MiB ZIP with one XML member; retains full XML and member metadata. Images are listed, not extracted. Join publication date from exact setid/version history; effectiveTime is distinct.",
            pathParams:[{name:"setid",type:"string",required:true,description:"Expected stable SPL set UUID."}],
            queryParams:[{name:"archive_id",type:"string",required:false,description:"Optional observed archive ID selects getArchivalFile; omit to use documented setid/version download."},{name:"expected_spl_version",type:"string",required:true,description:"Exact positive version string observed in listing/history; selects the direct download and verifies XML in both modes."},{name:"expected_xml_sha256",type:"string",required:false,description:"Optional original XML-byte SHA-256 guard."},{name:"expected_archive_sha256",type:"string",required:false,description:"Optional complete ZIP-byte SHA-256 guard."}],
            responseShape:"{spl_xml,setid,document_id,spl_version,effective_time,archive_id,archive_members,_dailymed:{archive_sha256,xml_sha256,xml_member,member_crc32_verified:true,historical_snapshot:true,publication_date:null}}",
            usageHint:"Check __staged/__api_error/__stage_error before fields. Retain full payloads and spl_documents XML for offline compare_spl.py; ZIP identity and section changes do not establish clinical significance."},
        {method: "GET", path: "/labels/{setid}/timeline", category: "spls", featured: true,
            summary: "Local dated publication-history selection with native pages, baseline candidates and explicit completeness. Fetches at most 10 history pages; does not retrieve archived XML or prove text changes.",
            pathParams: [{name: "setid", type: "string", required: true, description: "Stable SPL set UUID."}],
            queryParams: [
                {name: "since", type: "string", required: true, description: "Inclusive publication interval start YYYY-MM-DD."},
                {name: "until", type: "string", required: true, description: "Inclusive publication interval end YYYY-MM-DD."},
                {name: "max_pages", type: "number", required: false, description: "Local 1–10 page cap; default 5, 100 records per page. Incomplete histories do not yield baseline candidates."},
                {name: "expected_db_published_date", type: "string", required: false, description: "Local exact raw metadata.db_published_date check, if previously observed. Not a snapshot selector."},
            ]},
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
                "DO NOT USE — broken upstream. DailyMed serves single-SPL detail ONLY as XML; this .json detail endpoint returns HTTP 415 (Unsupported Media Type) for every Accept header (application/json, */*, none). Use `/spls/{setid}.xml` instead for one SPL's content, or `/spls.json?setid=...` (the LIST endpoint, which does return JSON) for a lightweight summary record. The `.json` suffix only works on LIST endpoints, never on the single-setid detail path.",
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
                "Unsupported: always 415. For a JSON summary of one label, call `/spls.json?setid={setid}` (list endpoint). For full label content, call `/spls/{setid}.xml`.",
        },
        {
            method: "GET",
            path: "/spls/{setid}.xml",
            summary:
                "Current full SPL XML with parsed document identity and SHA-256. Large results stage; current version guards fail if the requested older version is no longer current.",
            category: "spls",
            pathParams: [
                {
                    name: "setid",
                    type: "string",
                    required: true,
                    description: "SPL setid (stable UUID identifier)",
                },
            ],
            queryParams: [
                {name: "expected_spl_version", type: "string", required: false, description: "Local exact SPL version guard. Does not retrieve old revisions."},
                {name: "expected_xml_sha256", type: "string", required: false, description: "Local SHA-256 check on original UTF-8 response bytes."},
            ],
            usageHint: "Preserve spl_xml and _dailymed provenance. If staged, retain the handle and inspect get_schema; do not assume XML is inline. Use the offline compare_spl.py script with two verified same-setid files for section differences.",
            featured: true,
        },
        {
            method: "GET",
            path: "/spls/{setid}/history.json",
            summary:
                "One page of SPL revision history: data.history has spl_version/published_date, data.spl identifies the label, and metadata controls continuation. Use the local timeline helper for bounded dated selection.",
            category: "spls",
            pathParams: [
                {
                    name: "setid",
                    type: "string",
                    required: true,
                    description: "SPL setid (stable UUID identifier)",
                },
            ],
            queryParams: [
                {name: "page", type: "number", required: false, description: "1-based history page."},
                {name: "pagesize", type: "number", required: false, description: "History records per page, maximum 100."},
            ],
        },
        {
            method: "GET",
            path: "/rxcuis.json",
            summary: "Paginated product-level RxCUI list; filters are rxcui, rxstring and rxtty.",
            category: "rxcuis",
            queryParams: [
                {
                    name: "rxcui",
                    type: "string",
                    required: false,
                    description: "Filter by specific RxCUI",
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
                        "Filter by product-level RxNorm term type: PSN, SBD, SCD, BPCK, GPCK or SY.",
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
                "Local compatibility alias for /spls.json?rxcui=...; returns one page of labels, not a native RxCUI detail record.",
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
            summary: "Paginated native NDC list; only page/pagesize are documented. Use /spls.json?ndc=... for label lookup.",
            category: "ndcs",
            queryParams: [
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
            summary: "Local compatibility alias for /spls.json?ndc=...; returns one page of labels, not a native NDC detail record.",
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
                    name: "unii_code",
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
                "Local compatibility alias for native /drugclasses.json. Legacy class_code maps to drug_class_code and class_type maps to class_code_type; CS is not a documented type.",
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
                    enum: ["epc", "moa", "pe", "ci", "all"],
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
                "Local compatibility alias for /spls.json?drug_class_code=...; returns one page of labels, not a class detail record.",
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
        {method:"GET",path:"/drugclasses.json",category:"classes",summary:"Native paginated drug-class list. Documented filters currently returned HTTP 500; unfiltered paging works. Join code plus codingSystem to /spls.json.",queryParams:[
            ...["drug_class_code","drug_class_coding_system","class_code_type","class_name","unii_code"].map(name=>({name,type:"string" as const,required:false,description:name==="class_code_type"?"all, epc, moa, pe or ci; defaults to all.":"Native DailyMed filter; preserve coding system with codes."})),
            ...["page","pagesize"].map(name=>({name,type:"number" as const,required:false,description:"One-based page / records per page (maximum 100)."})),
        ]},
        ...["ndcs","media","packaging"].map(resource=>({method:"GET" as const,path:`/spls/{setid}/${resource}.json`,category:"spls",
            summary:`Native ${resource} for an explicit label set; retain native nested arrays and metadata.`,
            pathParams:[{name:"setid",type:"string" as const,required:true,description:"Exact SPL set UUID."}],
            queryParams:["page","pagesize"].map(name=>({name,type:"number" as const,required:false,description:"One-based page / records per page (maximum 100)."})),
        })),
    ],
    workflows: [
        {title:"Retrieve a documented historical version",description:"Select an observed publication-history version via the documented ZIP route. A 404 is retained; some inactive labels need an explicit archive ID from the listing instead.",keywords:["archive","version","ZIP"],code:"return await api.get('/labels/e9481622-7cc6-418a-acb6-c5450daae9b0/archive',{expected_spl_version:'29'});"},
        {title:"Discover dated archive candidates",description:"Retain one provider listing page and source HTML, then inspect archive IDs and versions before downloading. Older revisions also match the through-date filter.",keywords:["archive","historical","date","version"],
            code:"return await api.get('/labels/e9481622-7cc6-418a-acb6-c5450daae9b0/archives',{through:'2025-05-01',page:1});"},
        {title:"Read two verified historical revisions",description:"Retrieve two observed archive IDs for one set ID. Keep original XML, ZIP/member hashes and staged handles for offline section comparison; a difference is not a clinical-significance judgment.",keywords:["archive","comparison","revision","temporal","XML"],code:`
const setid='9aa7140c-012c-4ea6-866d-4732e915dab6';
const before=await api.get('/labels/'+setid+'/archive',{archive_id:'17238',expected_spl_version:'2'});
if(before.__api_error||before.__stage_error)return before;
const after=await api.get('/labels/'+setid+'/archive',{archive_id:'89126',expected_spl_version:'3'});
if(after.__api_error||after.__stage_error)return after;
return {setid,before,after,instruction:'Recover complete XML and compare with compare_spl.py using the observed XML SHA-256 values; publication dates come from exact setid/version history.'};`.trim()},
        {
            title: "Version-checked current SPL XML",
            description: "Select an explicit label, retain its summary, and reject current XML if its document version changed. Staged XML stays a handle; no regex section extraction.",
            keywords: ["spl", "xml", "boxed warning", "version", "label"],
            code: `
const setid = 'e9481622-7cc6-418a-acb6-c5450daae9b0';
const summary = await api.get('/spls.json', {setid, pagesize: 100});
if (summary.__staged || summary.__api_error || summary.__stage_error) return summary;
const labels = summary.data.filter(row => row.setid.toLowerCase() === setid);
if (labels.length !== 1) return {summary, error: 'Expected one explicit label; resolve ambiguity first'};
const xml = await api.get('/spls/' + setid + '.xml', {expected_spl_version: String(labels[0].spl_version)});
if (xml.__api_error || xml.__stage_error) return xml;
return {summary, xml, instruction: 'Retain staged handles. Compare full same-setid revisions with a proper XML parser; a missing regex match is not evidence of no warning.'};
`.trim(),
        },
        {
            title: "RxCUI to label candidates",
            description: "Retrieve one page of labels associated with a concept, keeping distinct set IDs, versions and paging metadata.",
            keywords: ["rxcui", "rxnorm", "label", "crosswalk"],
            code: `return await api.get('/spls.json', {rxcui: '1049502', page: 1, pagesize: 100});`,
        },
        {
            title: "Dated publication revisions and baseline candidates",
            description: "Select revisions between two publication dates and retain potential preceding versions. Follow completeness/unknown-date flags before making temporal claims; retrieve older content from Labeling Archives.",
            keywords: ["history", "version", "supersession", "timeline", "revision", "dated", "change"],
            code: `
const timeline = await api.get('/labels/e9481622-7cc6-418a-acb6-c5450daae9b0/timeline', {
  since: '2025-01-01', until: '2025-05-31', max_pages: 10
});
return timeline;
`.trim(),
        },
        {
            title: "Discover labels published since a date",
            description: "One page of current-label candidates with DailyMed publication dates; not a complete change log or all historical revisions in an interval.",
            keywords: ["published_date", "date", "changes", "label"],
            code: `return await api.get('/spls.json', {published_date: '2026-09-01', published_date_comparison: 'gte', page: 1, pagesize: 100});`,
        },
    ],
};
