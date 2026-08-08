import { user_repository } from './repositories/user.repository.js';
import { order_repository } from './repositories/order.repository.js';
import { user_service } from './services/user.service.js';
import { order_service } from './services/order.service.js';
import { register_user_routes } from './routes/user.routes.js';
import { register_order_routes } from './routes/order.routes.js';

export function build_server() {
  const users = new user_repository();
  const orders = new order_repository();

  const user_svc = new user_service(users, orders);
  const order_svc = new order_service(orders, user_svc);

  return {
    users: register_user_routes(user_svc),
    orders: register_order_routes(order_svc),
  };
}

export function start_server(port: number) {
  const app = build_server();
  console.log(`listening on ${port}`);
  return app;
}
