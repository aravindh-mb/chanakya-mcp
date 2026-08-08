export function build_help_text(binary_name: string): string {
  return `${binary_name} - local code intelligence MCP server for JavaScript and TypeScript

USAGE
  ${binary_name} [project-path] [options]

ARGUMENTS
  project-path            Root directory of the project to index.
                          Defaults to the current working directory.

OPTIONS
  -h, --help              Show this help and exit.
  -v, --version           Show the version and exit.
  -w, --watch             Keep running and reindex changed files.
      --force             Reindex every file, ignoring the change check.
      --log-level <level> silent | error | warn | info | debug  (default: info)
      --verbose           Shorthand for --log-level debug.
      --quiet             Shorthand for --log-level error.
      --                  Treat every following argument as the project path.

EXAMPLES
  npx @code-intelligence/mcp
  npx @code-intelligence/mcp /path/to/project
  ${binary_name} ./apps/api --verbose
  ${binary_name} --watch

NOTES
  All analysis runs locally. No source code leaves the machine.
  Diagnostics are written to stderr; stdout is reserved for the MCP protocol.
`;
}
