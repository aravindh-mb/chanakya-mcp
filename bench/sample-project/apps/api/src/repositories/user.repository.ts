import type { user, user_id } from '@sample/shared';

export class user_repository {
  private readonly rows = new Map<user_id, user>();

  async find_by_id(id: user_id): Promise<user | undefined> {
    return this.rows.get(id);
  }

  async find_by_email(email: string): Promise<user | undefined> {
    for (const row of this.rows.values()) {
      if (row.email === email) return row;
    }
    return undefined;
  }

  async insert(record: user): Promise<user> {
    this.rows.set(record.id, record);
    return record;
  }

  async remove(id: user_id): Promise<boolean> {
    return this.rows.delete(id);
  }

  async count(): Promise<number> {
    return this.rows.size;
  }
}
