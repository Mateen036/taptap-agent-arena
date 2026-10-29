import {
  testnetState,
  prepareTestnetQuote,
  executeTestnetQuote,
  confirmTestnetQuote,
  testnetArt,
  TestnetError,
  type TestnetEnv,
} from "../../../generated/nft-testnet";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const env = (): TestnetEnv => ({
  TESTNET_MODE: process.env.TESTNET_MODE,
  TESTNET_RPC_URL: process.env.TESTNET_RPC_URL,
  TESTNET_DEPLOYMENT: process.env.TESTNET_DEPLOYMENT,
  TESTNET_WALLETS: process.env.TESTNET_WALLETS,
  TESTNET_REVIEW_SECRET: process.env.TESTNET_REVIEW_SECRET,
});
async function route(request: Request) {
  try {
    const u = new URL(request.url),
      path = u.pathname.replace("/api/review", "");
    if (request.method === "GET" && path.startsWith("/art/"))
      return testnetArt(path.split("/").pop()!);
    if (request.method === "GET")
      return Response.json(
        await testnetState(
          env(),
          (u.searchParams.get("role") || "alpha") as any,
          Number(u.searchParams.get("page")) || 0,
        ),
        { headers: { "Cache-Control": "no-store" } },
      );
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (
      !request.headers.get("origin") ||
      !["http:", "https:"].some(
        (protocol) =>
          request.headers.get("origin") === protocol + "//" + request.headers.get("host"),
      )
    )
      return Response.json(
        { error: "Use this review website to prepare test transactions." },
        { status: 403 },
      );
    if (!request.headers.get("content-type")?.includes("application/json"))
      return new Response("Use JSON", { status: 415 });
    const text = await request.text();
    if (text.length > 24000) return new Response("Request too large", { status: 413 });
    let b: any;
    try {
      b = JSON.parse(text);
    } catch {
      throw new TestnetError(400, "Invalid JSON request.");
    }
    if (!b || typeof b !== "object" || Array.isArray(b))
      throw new TestnetError(400, "Use a JSON object.");
    const data =
      path === "/quote"
        ? await prepareTestnetQuote(env(), b)
        : path === "/execute"
          ? await executeTestnetQuote(env(), b)
          : path === "/receipt"
            ? await confirmTestnetQuote(env(), b)
            : null;
    if (!data) return new Response("Not found", { status: 404 });
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof TestnetError) return Response.json({ error: e.message }, { status: e.status });
    console.error("Testnet review failed", e instanceof Error ? e.name : "unknown");
    return Response.json(
      {
        error:
          "Testnet service unavailable. Check funding, contract deployment and RPC connectivity.",
      },
      { status: 503 },
    );
  }
}
export const GET = route;
export const POST = route;
