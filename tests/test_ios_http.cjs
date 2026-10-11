// Ensure iPhone WebViews without secure-context crypto.randomUUID still book.
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const js=fs.readFileSync(path.join(__dirname,"../custom_components/mittelhof_inventory/frontend/mittelhof-inventory-card.js"),"utf8");
const start=js.indexOf("function newTransactionId() {");
const end=js.indexOf("\nfunction el(",start);
assert.ok(start>=0&&end>start);
const functionCode=js.slice(start,end)+"\nnewTransactionId()";
const crypto={getRandomValues(bytes){for(let i=0;i<bytes.length;i++)bytes[i]=i+1;}};
const insecure=vm.runInNewContext(functionCode,{globalThis:{crypto},Uint8Array,Array,Date,Math});
assert.equal(insecure,"0102030405060708090a0b0c0d0e0f10");
const noCrypto=vm.runInNewContext(functionCode,{globalThis:{},Uint8Array,Array,Date,Math});
assert.match(noCrypto,/^fallback-[a-z0-9-]+$/);
assert.notEqual(insecure,noCrypto);
assert.ok(!js.includes("idempotency_key:crypto.randomUUID()"));
console.log("Insecure-context idempotency fallback passed");
