import { order_service } from '../services/order.service.js';
import type { http_request, http_response } from './user.routes.js';

export function register_order_routes(service: order_service) {
  return {
    async create(request: http_request, response: http_response) {
      const user_id = String(request.body['user_id'] ?? '');
      const total_cents = Number(request.body['total_cents'] ?? 0);
      try {
        const placed = await service.place_order(user_id, total_cents);
        response.status(201).json(placed);
      } catch (error) {
        response.status(400).json({ message: (error as Error).message });
      }
    },

    async index(request: http_request, response: http_response) {
      const orders = await service.list_orders(request.params['user_id'] ?? '');
      response.status(200).json(orders);
    },
  };
}
