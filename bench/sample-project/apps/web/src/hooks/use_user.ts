import { useEffect, useState } from 'react';
import type { user, user_id } from '@sample/shared';

export function use_user(id: user_id) {
  const [current, set_current] = useState<user | undefined>(undefined);
  const [loading, set_loading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/users/${id}`)
      .then((response) => response.json())
      .then((payload: user) => {
        if (!cancelled) {
          set_current(payload);
          set_loading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return { current, loading };
}
