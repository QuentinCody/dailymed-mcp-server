import type { McpServer } from "@bio-mcp/shared/mcp";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { dailymedCatalog } from "../spec/catalog";
import { createDailymedApiFetch } from "../lib/api-adapter";
import { dailymedResponse } from "../lib/tool-result";

interface CodeModeEnv {
    DAILYMED_DATA_DO: DurableObjectNamespace;
    CODE_MODE_LOADER: WorkerLoader;
}

export function registerCodeMode(
    server: McpServer,
    env: CodeModeEnv,
): void {
    const apiFetch = createDailymedApiFetch();
    const registrar = {tool: (...args: unknown[]) => {
        const [name, ...rest] = args;
        const callback=rest.pop() as (args:unknown,extra:unknown)=>ReturnType<Parameters<typeof dailymedResponse>[0]>;
        const register = server.tool.bind(server) as (...values: unknown[]) => void;
        for(const alias of [String(name),`mcp_${String(name)}`])register(alias,...rest,(args:unknown,extra:unknown)=>dailymedResponse(()=>callback(args,extra),env,alias,extra,args));
    }};

    const searchTool = createSearchTool({
        prefix: "dailymed",
        catalog: dailymedCatalog,
    });
    searchTool.register(registrar);

    const executeTool = createExecuteTool({
        prefix: "dailymed",
        // Verifiable provenance: dailymed_execute results carry a _meta.citation.
        source: { id: "dailymed", name: "DailyMed", url: "https://dailymed.nlm.nih.gov" },
        catalog: dailymedCatalog,
        apiFetch,
        preserveApiErrors: true,
        maxInlineBytes: 30 * 1024,
        stagingThreshold: 30 * 1024,
        timeout: 60_000,
        doNamespace: env.DAILYMED_DATA_DO,
        loader: env.CODE_MODE_LOADER,
    });
    executeTool.register(registrar);
}
