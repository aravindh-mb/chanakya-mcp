# Docker Deployment

Run Chanakya MCP in a Docker container for instant setup without installing Node.js or pnpm locally.

## Quick Start

### Option 1: Pull from Docker Hub

```bash
docker pull aravindharumugam/chanakya-mcp:latest
docker run --rm -v /path/to/your/project:/workspace aravindharumugam/chanakya-mcp:latest .
```

### Option 2: Build Locally

```bash
docker build -t chanakya-mcp:latest .
docker run --rm -v /path/to/your/project:/workspace chanakya-mcp:latest .
```

### Option 3: Use Docker Compose

```bash
# Place your project in ./project-to-scan
docker-compose up
```

## Usage

The Docker image runs the Chanakya MCP CLI. Mount your project directory and pass arguments:

```bash
# Index current directory
docker run --rm -v $(pwd):/workspace chanakya-mcp:latest .

# Index specific project
docker run --rm -v /path/to/project:/workspace chanakya-mcp:latest /workspace

# Run with watch mode
docker run --rm -v $(pwd):/workspace chanakya-mcp:latest . --watch

# Verbose logging
docker run --rm -v $(pwd):/workspace chanakya-mcp:latest . --verbose
```

## Container Details

- **Base Image:** `node:20-alpine` (lightweight)
- **Working Directory:** `/app` (for the MCP server)
- **Entry Point:** `node dist/cli/main.js`
- **Non-root User:** `nodejs` (UID: 1001)

## Building Multi-Platform

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t aravindharumugam/chanakya-mcp:latest --push .
```

## Push to Docker Hub

```bash
docker tag chanakya-mcp:latest aravindharumugam/chanakya-mcp:latest
docker push aravindharumugam/chanakya-mcp:latest
```

## AI Integration via Docker

Use with Claude Code, Cursor, or other AI agents:

```bash
docker run --rm -v /path/to/project:/workspace -i chanakya-mcp:latest /workspace
```

This keeps the MCP server running on stdio for AI agent integration.
