import { handleRequest } from '../server/index.js';

// Vercel catch-all function for the existing /api/* routes.
export default async function handler(req, res) {
  return handleRequest(req, res);
}
