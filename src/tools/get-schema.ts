import type { McpServer } from "@bio-mcp/shared/mcp";
import { z } from "zod";
import { createGetSchemaHandler } from "@bio-mcp/shared/staging/utils";
import { dailymedResponse } from "../lib/tool-result";

interface SchemaEnv {
    DAILYMED_DATA_DO?: unknown;
}

export function registerGetSchema(server: McpServer, env?: SchemaEnv): void {
    const handler = createGetSchemaHandler("DAILYMED_DATA_DO", "dailymed");

    for (const name of ["dailymed_get_schema", "mcp_dailymed_get_schema"]) server.registerTool(
        name,
        {
            title: "Get Staged DailyMed Data Schema",
            description:
                "Get schema information for staged DailyMed data. Shows table structures and row counts. " +
                "If called without a data_access_id, lists all staged datasets available in this session.",
            inputSchema: {
                data_access_id: z
                    .string()
                    .min(1)
                    .optional()
                    .describe(
                        "Data access ID for the staged dataset. If omitted, lists all staged datasets in this session.",
                    ),
            },
        },
        async (args, extra) => {
            const runtimeEnv = env || (extra as { env?: SchemaEnv })?.env || {};
            return dailymedResponse(()=>handler(
                args as Record<string, unknown>,
                runtimeEnv as Record<string, unknown>,
                (extra as Record<string, unknown>),
            ),runtimeEnv,name,extra,args);
        },
    );
}
