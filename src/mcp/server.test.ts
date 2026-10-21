import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

/**
 * Integration test for the MCP server over its real stdio transport.
 *
 * The server is spawned as a separate process because the transport *is*
 * stdin/stdout — importing it in-process would test everything except the
 * part most likely to break.
 */

const SERVER = fileURLToPath(new URL("./server.js", import.meta.url));

interface RpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Send the given messages, collect responses until all ids are answered. */
async function rpc(messages: unknown[], expected: number): Promise<RpcResponse[]> {
  const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"] });
  const responses: RpcResponse[] = [];

  const rl = createInterface({ input: child.stdout });
  const done = new Promise<void>((resolve, reject) => {
    rl.on("line", (line) => {
      try {
        responses.push(JSON.parse(line) as RpcResponse);
      } catch {
        reject(new Error(`server wrote non-JSON: ${line}`));
      }
      if (responses.length >= expected) resolve();
    });
    child.on("error", reject);
    setTimeout(() => reject(new Error(`timed out after ${responses.length}/${expected} responses`)), 20_000);
  });

  for (const m of messages) child.stdin.write(JSON.stringify(m) + "\n");
  await done;
  child.stdin.end();
  child.kill();
  return responses;
}

test("mcp: initialize reports protocol version and tool capability", async () => {
  const [res] = await rpc(
    [{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {} } }],
    1,
  );
  assert.equal(res.id, 1);
  const result = res.result as {
    protocolVersion: string;
    capabilities: { tools: unknown };
    serverInfo: { name: string };
  };
  assert.equal(result.serverInfo.name, "greenbump");
  assert.ok(typeof result.protocolVersion === "string");
  assert.deepEqual(result.capabilities.tools, {});
});

test("mcp: tools/list exposes the four read-only tools with schemas", async () => {
  const responses = await rpc(
    [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ],
    2,
  );
  const res = responses.find((r) => r.id === 2)!;
  assert.ok(res, "tools/list was not answered");
  const tools = (res.result as { tools: Array<{ name: string; description: string; inputSchema: unknown }> }).tools;
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["check_upgrade", "list_outdated", "scan_impact", "security_scan"]);
  for (const t of tools) {
    assert.ok(t.description.length > 20, `${t.name} has a thin description`);
    assert.equal((t.inputSchema as { type: string }).type, "object");
  }
});

test("mcp: notifications (no id) produce no response", async () => {
  // Send a notification then a ping; only the ping may be answered.
  const responses = await rpc(
    [
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 7, method: "ping" },
    ],
    1,
  );
  assert.equal(responses.length, 1);
  assert.equal(responses[0].id, 7);
});

test("mcp: an unknown method returns a JSON-RPC method-not-found error", async () => {
  const [res] = await rpc([{ jsonrpc: "2.0", id: 3, method: "does/not/exist" }], 1);
  assert.equal(res.error?.code, -32601);
});

test("mcp: an unknown tool returns an error rather than crashing the server", async () => {
  const [res] = await rpc(
    [
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "nonexistent_tool", arguments: {} },
      },
    ],
    1,
  );
  assert.equal(res.error?.code, -32602);
});

test("mcp: check_upgrade without a dep returns a helpful message, not an error", async () => {
  const [res] = await rpc(
    [{ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "check_upgrade", arguments: {} } }],
    1,
  );
  const content = (res.result as { content: Array<{ text: string }> }).content;
  assert.match(content[0].text, /requires a `dep` parameter/);
});