/** The in-process MCP server name; the SDK exposes its tools as mcp__<server>__<tool>. */
export const MCP_NAME = "ha";
export const toolId = (name: string) => `mcp__${MCP_NAME}__${name}`;
