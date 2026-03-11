import { proxyToGo } from "@/lib/go-proxy";

export async function GET(request: Request) {
  return proxyToGo(request, "/api/meta/auth/callback");
}
