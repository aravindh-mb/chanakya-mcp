#!/usr/bin/env node
import { run_cli } from './run_cli.js';

const exit_status = await run_cli({ argv: process.argv.slice(2) });
process.exitCode = exit_status;
