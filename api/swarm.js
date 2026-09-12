import { createApp } from '../server.js';

let appPromise;

export default async function handler(request, response) {
  appPromise ||= createApp({ development: false });
  const app = await appPromise;
  return app(request, response);
}
