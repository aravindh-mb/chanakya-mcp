export interface user {
  id: string;
  email: string;
  display_name: string;
  created_at: number;
}

export interface order {
  id: string;
  user_id: string;
  total_cents: number;
  status: order_status;
}

export type order_status = 'pending' | 'paid' | 'shipped' | 'cancelled';

export type user_id = string;

export interface paginated<item> {
  items: item[];
  total: number;
  page: number;
}
