import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import type { SchemaHints } from "@bio-mcp/shared/staging/schema-inference";

export class DailymedDataDO extends RestStagingDO {
    protected getSchemaHints(data: unknown): SchemaHints | undefined {
        if (!data || typeof data !== "object") return undefined;

        // Full SPL XML blob (returned by /spls/{setid}.xml — TEXT passthrough, parsed client-side)
        const obj = data as Record<string, unknown>;
        if (typeof obj.spl_xml === "string" || typeof obj.xml === "string") {
            return {
                tableName: "spl_documents",
                indexes: ["setid"],
            };
        }

        if (Array.isArray(data)) {
            const sample = data[0];
            if (sample && typeof sample === "object") {
                const s = sample as Record<string, unknown>;
                // SPL listing (/spls.json paginated results)
                if ("setid" in s && ("spl_version" in s || "title" in s || "published_date" in s)) {
                    return {
                        tableName: "spls",
                        indexes: ["setid", "spl_version", "published_date"],
                    };
                }
                // RxCUI listing
                if ("rxcui" in s) {
                    return {
                        tableName: "rxcuis",
                        indexes: ["rxcui", "setid"],
                    };
                }
                // NDC listing
                if ("ndc" in s) {
                    return {
                        tableName: "ndcs",
                        indexes: ["ndc", "setid"],
                    };
                }
                // Drug name listing
                if ("drug_name" in s) {
                    return {
                        tableName: "drugnames",
                        indexes: ["drug_name", "setid"],
                    };
                }
                // UNII listing
                if ("unii" in s) {
                    return {
                        tableName: "uniis",
                        indexes: ["unii"],
                    };
                }
                // Pharmacologic class listing
                if ("class_name" in s || "class_code" in s) {
                    return {
                        tableName: "pharmacologic_classes",
                        indexes: ["class_code", "class_name"],
                    };
                }
                // Application number listing
                if ("application_number" in s) {
                    return {
                        tableName: "application_numbers",
                        indexes: ["application_number", "setid"],
                    };
                }
            }
        }

        // DailyMed wraps paginated results as { data: [...], metadata: {...} }
        if (Array.isArray(obj.data)) {
            const first = (obj.data as unknown[])[0];
            if (first && typeof first === "object") {
                const s = first as Record<string, unknown>;
                if ("setid" in s) {
                    return { tableName: "spls", indexes: ["setid"] };
                }
                if ("rxcui" in s) {
                    return { tableName: "rxcuis", indexes: ["rxcui"] };
                }
                if ("ndc" in s) {
                    return { tableName: "ndcs", indexes: ["ndc"] };
                }
            }
        }

        return undefined;
    }
}
