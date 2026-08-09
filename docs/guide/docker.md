# Docker Deployment

Run Chanakya MCP in a containerized environment without installing Node.js, npm, or pnpm locally.

## Quick Start

### Pull from Docker Hub

```bash
docker pull aravindharumugam/chanakya-mcp:latest
docker run -v /path/to/your/project:/workspace aravindharumugam/chanakya-mcp:latest .
```

### Build Locally

```bash
git clone https://github.com/aravindh-mb/chanakya-mcp.git
cd chanakya-mcp

docker build -t chanakya-mcp:latest .
docker run -v /path/to/your/project:/workspace chanakya-mcp:latest .
```

---

## Usage Examples

### Index a Project

```bash
# Index current directory
docker run --rm -v $(pwd):/workspace aravindharumugam/chanakya-mcp:latest .

# Index specific project path
docker run --rm -v /path/to/project:/workspace aravindharumugam/chanakya-mcp:latest /workspace

# Index with Windows path (PowerShell)
docker run --rm -v ${PWD}:/workspace aravindharumugam/chanakya-mcp:latest .
```

### Enable Watch Mode

```bash
# Automatically reindex on file changes
docker run --rm -v $(pwd):/workspace aravindharumugam/chanakya-mcp:latest . --watch
```

### Verbose Logging

```bash
# Enable debug output
docker run --rm -v $(pwd):/workspace aravindharumugam/chanakya-mcp:latest . --verbose
```

### MCP Server Mode (for AI Agents)

```bash
# Run as stdio server for Claude Code, Cursor, Windsurf, etc.
docker run --rm -i -v /path/to/project:/workspace aravindharumugam/chanakya-mcp:latest /workspace
```

---

## Docker Compose

For easier management, use Docker Compose:

```yaml
version: '3.8'

services:
  chanakya-mcp:
    image: aravindharumugam/chanakya-mcp:latest
    volumes:
      - ./my-project:/workspace
    working_dir: /workspace
    command: ["."]
```

Save as `docker-compose.yml` and run:

```bash
# Start the service
docker-compose up

# Run with watch mode
docker-compose run chanakya-mcp . --watch

# Run with verbose logging
docker-compose run chanakya-mcp . --verbose
```

---

## Container Details

| Detail | Value |
| :--- | :--- |
| **Base Image** | `node:20-alpine` |
| **Size** | ~500 MB (optimized with multi-stage build) |
| **Entry Point** | `node dist/cli/main.js` |
| **Working Directory** | `/app` |
| **User** | `nodejs` (UID: 1001, non-root) |

---

## Volume Mounts

When running Docker, mount your project directory:

```bash
# Mount current directory
docker run -v $(pwd):/workspace chanakya-mcp:latest .

# Mount with read-only access (recommended)
docker run -v $(pwd):/workspace:ro chanakya-mcp:latest .
```

The container stores the `.chanakya` index at `/workspace/.chanakya/index.db` inside the mounted directory.

---

## CLI Flags in Docker

All standard Chanakya MCP flags work inside Docker:

```bash
# List all available flags
docker run aravindharumugam/chanakya-mcp:latest . --help

# Common flags
docker run -v $(pwd):/workspace aravindharumugam/chanakya-mcp:latest . \
  --watch \
  --verbose \
  --log-level debug
```

---

## Building Multi-Platform Images

Build for multiple architectures (AMD64, ARM64):

```bash
# Requires buildx
docker buildx build --platform linux/amd64,linux/arm64 \
  -t aravindharumugam/chanakya-mcp:latest \
  --push .
```

---

## Troubleshooting

### Permission Denied

If you get permission errors accessing the mounted volume:

```bash
# Run with user permissions
docker run --user $(id -u):$(id -g) \
  -v $(pwd):/workspace aravindharumugam/chanakya-mcp:latest .
```

### Docker Not Found

Ensure Docker is installed and running:

```bash
docker --version
docker run hello-world
```

### Index Issues

Clear and rebuild the index:

```bash
# Remove existing index
rm -rf .chanakya/

# Rebuild in Docker
docker run -v $(pwd):/workspace aravindharumugam/chanakya-mcp:latest . --force
```

---

## CI/CD Integration

### GitHub Actions

```yaml
name: Index Project with Chanakya MCP

on: [push]

jobs:
  index:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run Chanakya MCP
        run: |
          docker run --rm -v ${{ github.workspace }}:/workspace \
            aravindharumugam/chanakya-mcp:latest .
```

### Docker Compose in CI

```bash
docker-compose run --rm chanakya-mcp . --force
```

---

## Network & Security

The Docker image is **network-isolated**:

- ✓ No external API calls
- ✓ No telemetry collection
- ✓ 100% local processing
- ✓ Safe for private/proprietary code
- ✓ Works offline

---

## Next Steps

- [AI Agent Integration](/guide/getting-started#connecting-to-ai-coding-agents)
- [CLI Reference](/guide/getting-started#command-line-interface-cli)
- [Architecture Overview](/reference/architecture)
