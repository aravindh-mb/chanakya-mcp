import type { user } from './types.js';

export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function is_valid_email(email: string): boolean {
  return EMAIL_PATTERN.test(email);
}

export function validate_user(candidate: Partial<user>): string[] {
  const problems: string[] = [];
  if (candidate.email === undefined || !is_valid_email(candidate.email)) {
    problems.push('email is invalid');
  }
  if (candidate.display_name === undefined || candidate.display_name.length === 0) {
    problems.push('display_name is required');
  }
  return problems;
}

export function format_money(total_cents: number): string {
  return `$${(total_cents / 100).toFixed(2)}`;
}
