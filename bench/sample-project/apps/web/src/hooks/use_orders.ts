import { useEffect, useState } from 'react';
import type { order, user_id } from '@sample/shared';

export function use_orders(id: user_id) {
  const [orders, set_orders] = useState<order[]>([]);

  useEffect(() => {
    fetch(`/api/users/${id}/orders`)
      .then((response) => response.json())
      .then(set_orders);
  }, [id]);

  return orders;
}
