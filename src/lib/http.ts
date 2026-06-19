import { restFetch } from "@bio-mcp/shared/http/rest-fetch";
import type { RestFetchOptions } from "@bio-mcp/shared/http/rest-fetch";

const DAILYMED_BASE = "https://dailymed.nlm.nih.gov/dailymed/services/v2";

export interface DailymedFetchOptions extends Omit<RestFetchOptions, "retryOn"> {
    baseUrl?: string;
}

/**
 * Fetch from the DailyMed REST API (NLM).
 *
 * The v2 services speak two content types:
 *   - .json endpoints → application/json (default Accept header)
 *   - .xml  endpoints → full SPL XML (the differentiator vs openFDA)
 *
 * NOTE: the .xml endpoints reject `Accept: application/xml` with HTTP 406
 * ("Could not satisfy the request Accept header"); they only return the SPL
 * when Accept is absent, `* /*`, or `application/json`. So we send `* /*` for
 * .xml paths and reserve `application/json` for the .json list endpoints.
 *
 * The path suffix is used to choose the Accept header. Callers do not need to
 * pass one explicitly; the adapter strips it back out before the api-proxy
 * routes the request through the V8 isolate's `api.get()`.
 */
export async function dailymedFetch(
    path: string,
    params?: Record<string, unknown>,
    opts?: DailymedFetchOptions,
): Promise<Response> {
    const baseUrl = opts?.baseUrl ?? DAILYMED_BASE;
    const isXml = path.toLowerCase().endsWith(".xml");
    const headers: Record<string, string> = {
        Accept: isXml ? "*/*" : "application/json",
        ...(opts?.headers ?? {}),
    };

    return restFetch(baseUrl, path, params, {
        ...opts,
        headers,
        retryOn: [429, 500, 502, 503, 504],
        retries: opts?.retries ?? 3,
        timeout: opts?.timeout ?? 45_000,
        userAgent: "dailymed-mcp-server/1.0 (bio-mcp)",
    });
}
