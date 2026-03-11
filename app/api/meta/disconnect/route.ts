import { proxyToGo } from "@/lib/go-proxy";

export async function GET(request: Request) {
  return proxyToGo(request, "/api/meta/disconnect");
}

export async function POST(request: Request) {
  return proxyToGo(request, "/api/meta/disconnect");
}
