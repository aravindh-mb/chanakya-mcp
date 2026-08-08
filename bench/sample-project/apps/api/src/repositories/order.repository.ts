import type { order, user_id } from '@sample/shared';

export class order_repository {
  private readonly rows: order[] = [];

  async find_for_user(id: user_id): Promise<order[]> {
    return this.rows.filter((row) => row.user_id === id);
  }

  async insert(record: order): Promise<order> {
    this.rows.push(record);
    return record;
  }

  async total_for_user(id: user_id): Promise<number> {
    const orders = await this.find_for_user(id);
    return orders.reduce((sum, row) => sum + row.total_cents, 0);
  }
}
