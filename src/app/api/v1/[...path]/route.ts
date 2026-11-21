import { handleRequest } from "@/server/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ path: string[] }> };

async function dispatch(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  return handleRequest(req, path);
}

export async function GET(req: Request, ctx: Ctx) {
  return dispatch(req, ctx);
}
export async function POST(req: Request, ctx: Ctx) {
  return dispatch(req, ctx);
}
export async function PATCH(req: Request, ctx: Ctx) {
  return dispatch(req, ctx);
}
export async function PUT(req: Request, ctx: Ctx) {
  return dispatch(req, ctx);
}
export async function DELETE(req: Request, ctx: Ctx) {
  return dispatch(req, ctx);
}
