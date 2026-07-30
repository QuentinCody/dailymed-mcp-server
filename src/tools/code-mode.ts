import type { McpServer } from "@bio-mcp/shared/mcp";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { dailymedCatalog } from "../spec/catalog";
import { createDailymedApiFetch } from "../lib/api-adapter";

interface CodeModeEnv {
    DAILYMED_DATA_DO: DurableObjectNamespace;
    CODE_MODE_LOADER: WorkerLoader;
}

export function registerCodeMode(
    server: McpServer,
    env: CodeModeEnv,
): void {
    const apiFetch = createDailymedApiFetch();

    const searchTool = createSearchTool({
        prefix: "dailymed",
        catalog: dailymedCatalog,
    });
    searchTool.register(server as unknown as { tool: (...args: unknown[]) => void });

    const executeTool = createExecuteTool({
        prefix: "dailymed",
        // Verifiable provenance: dailymed_execute results carry a _meta.citation.
        source: { id: "dailymed", name: "DailyMed", url: "https://dailymed.nlm.nih.gov", license: "U.S. Public Domain" },
        catalog: dailymedCatalog,
        apiFetch,
        doNamespace: env.DAILYMED_DATA_DO,
        loader: env.CODE_MODE_LOADER,
    });
    executeTool.register(server as unknown as { tool: (...args: unknown[]) => void });
}
