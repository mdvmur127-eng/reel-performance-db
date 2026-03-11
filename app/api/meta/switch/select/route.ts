import { proxyToGo } from "@/lib/go-proxy";

export async function POST(request: Request) {
  return proxyToGo(request, "/api/meta/switch/select");
}
