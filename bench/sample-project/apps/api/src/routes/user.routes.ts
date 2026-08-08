import { user_service } from '../services/user.service.js';

export interface http_request {
  params: Record<string, string>;
  body: Record<string, unknown>;
}

export interface http_response {
  status(code: number): http_response;
  json(payload: unknown): void;
}

export function register_user_routes(service: user_service) {
  return {
    async create(request: http_request, response: http_response) {
      const email = String(request.body['email'] ?? '');
      const display_name = String(request.body['display_name'] ?? '');
      try {
        const created = await service.create_user(email, display_name);
        response.status(201).json(created);
      } catch (error) {
        response.status(400).json({ message: (error as Error).message });
      }
    },

    async show(request: http_request, response: http_response) {
      const found = await service.get_user(request.params['id'] ?? '');
      if (found === undefined) {
        response.status(404).json({ message: 'not found' });
        return;
      }
      response.status(200).json(found);
    },

    async destroy(request: http_request, response: http_response) {
      const removed = await service.delete_user(request.params['id'] ?? '');
      response.status(removed ? 204 : 404).json(null);
    },
  };
}
