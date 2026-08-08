import { format_money } from '@sample/shared';
import type { order } from '@sample/shared';

export interface order_list_props {
  orders: order[];
}

export function OrderList({ orders }: order_list_props) {
  if (orders.length === 0) {
    return <p>No orders yet.</p>;
  }

  return (
    <ul className="order-list">
      {orders.map((item) => (
        <li key={item.id}>
          <span>{item.status}</span>
          <span>{format_money(item.total_cents)}</span>
        </li>
      ))}
    </ul>
  );
}
