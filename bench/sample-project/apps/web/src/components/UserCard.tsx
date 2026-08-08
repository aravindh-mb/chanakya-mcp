import { format_money } from '@sample/shared';
import type { user } from '@sample/shared';
import { use_orders } from '../hooks/use_orders.js';

export interface user_card_props {
  person: user;
  on_select?: (id: string) => void;
}

export function UserCard({ person, on_select }: user_card_props) {
  const orders = use_orders(person.id);
  const total = orders.reduce((sum, item) => sum + item.total_cents, 0);

  return (
    <div className="user-card" onClick={() => on_select?.(person.id)}>
      <h3>{person.display_name}</h3>
      <p>{person.email}</p>
      <span>{format_money(total)}</span>
    </div>
  );
}
