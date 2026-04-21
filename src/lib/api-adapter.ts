import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { dailymedFetch } from "./http";

/**
 * DailyMed REST adapter.
 *
 * Content handling:
 *   - `.json` suffix → parsed JSON
 *   - `.xml`  suffix → returned as a TEXT string; Code Mode parses with
 *     `DOMParser` in the V8 isolate (see §10 of the biomni gap-closure plan —
 *     server-side LOINC-section extraction is intentionally out of scope).
 *   - other content-types → returned as text (passthrough; upstream is usually
 *     XML fallback).
 *
 * When XML is staged, the DO stores it as a single-column TEXT row with a
 * `spl_xml` field so Code Mode can pull it back via `SELECT spl_xml FROM
 * spl_documents WHERE setid=?`.
 */
export function createDailymedApiFetch(): ApiFetchFn {
    return async (request) => {
        const path = request.path;
        const isXml = path.toLowerCase().endsWith(".xml");

        const response = await dailymedFetch(path, request.params);

        if (!response.ok) {
            let errorBody: string;
            try {
                errorBody = await response.text();
            } catch {
                errorBody = response.statusText;
            }
            const error = new Error(
                `HTTP ${response.status}: ${errorBody.slice(0, 200)}`,
            ) as Error & { status: number; data: unknown };
            error.status = response.status;
            error.data = errorBody;
            throw error;
        }

        const contentType = (response.headers.get("content-type") || "").toLowerCase();

        // Full SPL XML — hand back as TEXT in an envelope that staging can index.
        if (isXml || contentType.includes("xml")) {
            const xmlText = await response.text();
            return {
                status: response.status,
                data: {
                    content_type: "application/xml",
                    spl_xml: xmlText,
                    // Best-effort setid extraction from path (/spls/{setid}.xml) so the
                    // caller can join/filter without re-parsing in SQL.
                    setid: extractSetid(path),
                    length: xmlText.length,
                },
            };
        }

        if (!contentType.includes("json")) {
            const text = await response.text();
            return { status: response.status, data: text };
        }

        const data = await response.json();
        return { status: response.status, data };
    };
}

function extractSetid(path: string): string | undefined {
    // /spls/{setid}.xml | /spls/{setid}.json | /spls/{setid}/history.json
    const m = /\/spls\/([^/.?#]+)(?:\/|\.|$)/i.exec(path);
    return m ? m[1] : undefined;
}
