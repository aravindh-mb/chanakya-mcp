import type { order, user_id } from '@sample/shared';
import { order_repository } from '../repositories/order.repository.js';
import { user_service } from './user.service.js';

export class order_service {
  constructor(
    private readonly orders: order_repository,
    private readonly users: user_service,
  ) {}

  async place_order(id: user_id, total_cents: number): Promise<order> {
    const owner = await this.users.get_user(id);
    if (owner === undefined) {
      throw new Error('unknown user');
    }

    return this.orders.insert({
      id: crypto.randomUUID(),
      user_id: id,
      total_cents,
      status: 'pending',
    });
  }

  async list_orders(id: user_id): Promise<order[]> {
    return this.orders.find_for_user(id);
  }
}
