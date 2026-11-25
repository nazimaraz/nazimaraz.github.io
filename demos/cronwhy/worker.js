// Runs the unmodified cronwhy CLI (Go, GOOS=js GOARCH=wasm) once per message.
// in: { args: string[], stdin: string }   out: { output: string, code: number }
"use strict";

importScripts("wasm_exec.js");

const decoder = new TextDecoder();
let output = "";
let stdin = new Uint8Array();
let stdinAt = 0;

globalThis.fs.writeSync = (fd, buf) => {
  output += decoder.decode(buf, { stream: true });
  return buf.length;
};
globalThis.fs.read = (fd, buffer, offset, length, position, callback) => {
  const chunk = fd === 0 ? stdin.subarray(stdinAt, stdinAt + length) : new Uint8Array();
  buffer.set(chunk, offset);
  stdinAt += chunk.length;
  callback(null, chunk.length);
};

const compiled = fetch("cronwhy.wasm").then((r) => {
  if (!r.ok) throw new Error(`cronwhy.wasm: HTTP ${r.status}`);
  return r.arrayBuffer();
}).then((bytes) => WebAssembly.compile(bytes));

onmessage = async ({ data }) => {
  try {
    const module = await compiled;
    output = "";
    stdin = new TextEncoder().encode(data.stdin || "");
    stdinAt = 0;
    const go = new Go();
    let code = 0;
    go.exit = (c) => { code = c; };
    go.argv = ["cronwhy", ...data.args];
    go.env = { NO_COLOR: "1" };
    const instance = await WebAssembly.instantiate(module, go.importObject);
    await go.run(instance);
    postMessage({ output, code });
  } catch (error) {
    postMessage({ output: String(error && error.message || error), code: -1 });
  }
};
