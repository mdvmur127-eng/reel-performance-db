import { proxyToGo } from "@/lib/go-proxy";

export async function GET(request: Request) {
  return proxyToGo(request, "/api/metrics");
}

export async function POST(request: Request) {
  return proxyToGo(request, "/api/metrics");
}

export async function PATCH(request: Request) {
  return proxyToGo(request, "/api/metrics");
}
