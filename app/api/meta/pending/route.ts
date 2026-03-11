import { proxyToGo } from "@/lib/go-proxy";

export async function GET(request: Request) {
  return proxyToGo(request, "/api/meta/pending");
}

export async function DELETE(request: Request) {
  return proxyToGo(request, "/api/meta/pending");
}
