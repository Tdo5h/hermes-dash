/** Bearer token shared with Hermes gateway (`HERMES_TOKEN` === `API_SERVER_KEY`). */
export function authorizeHermesGatewayToken(req: Request): boolean {
  const token = process.env.HERMES_TOKEN?.trim();
  if (!token) return false;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${token}`;
}
