/**
 * Errors that cross the MCP boundary.
 *
 * `tool_error` is a business failure the model should see and recover from — a
 * missing symbol, a file that changed since indexing, an ambiguous patch — as
 * opposed to a protocol failure. The server reports it as a failed tool result
 * (`isError`) rather than a JSON-RPC error, so the text reaches the model.
 *
 * Defined in its own module (rather than next to the tools) because the edit
 * layer raises it too, and pulling it into `tools.ts` would create an import
 * cycle.
 */

export class tool_error extends Error {}
