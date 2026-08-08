import type { log_level } from '../core/logger.js';

export interface cli_options {
  /** Raw project path from argv, if the user provided one. */
  readonly project_path: string | undefined;
  readonly log_level: log_level;
  readonly show_help: boolean;
  readonly show_version: boolean;
}

export const EXIT_CODE = {
  success: 0,
  runtime_error: 1,
  usage_error: 2,
} as const;

export type exit_code = (typeof EXIT_CODE)[keyof typeof EXIT_CODE];
