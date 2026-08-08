import { use_user } from '../hooks/use_user.js';
import { use_orders } from '../hooks/use_orders.js';
import { UserCard } from './UserCard.js';
import { OrderList } from './OrderList.js';

export interface dashboard_props {
  user_id: string;
}

export function Dashboard({ user_id }: dashboard_props) {
  const { current, loading } = use_user(user_id);
  const orders = use_orders(user_id);

  if (loading || current === undefined) {
    return <p>Loading…</p>;
  }

  return (
    <main>
      <UserCard person={current} />
      <OrderList orders={orders} />
    </main>
  );
}
