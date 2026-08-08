import { validate_user } from '@sample/shared';
import type { user, user_id } from '@sample/shared';
import { user_repository } from '../repositories/user.repository.js';
import { order_repository } from '../repositories/order.repository.js';

export class user_service {
  constructor(
    private readonly users: user_repository,
    private readonly orders: order_repository,
  ) {}

  async create_user(email: string, display_name: string): Promise<user> {
    const problems = validate_user({ email, display_name });
    if (problems.length > 0) {
      throw new Error(problems.join(', '));
    }

    const existing = await this.users.find_by_email(email);
    if (existing !== undefined) {
      throw new Error('email already registered');
    }

    return this.users.insert({
      id: crypto.randomUUID(),
      email,
      display_name,
      created_at: Date.now(),
    });
  }

  async get_user(id: user_id): Promise<user | undefined> {
    return this.users.find_by_id(id);
  }

  async delete_user(id: user_id): Promise<boolean> {
    return this.users.remove(id);
  }

  async lifetime_value(id: user_id): Promise<number> {
    return this.orders.total_for_user(id);
  }
}
