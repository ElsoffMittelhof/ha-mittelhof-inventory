// Smoke-test every shipped Lovelace card using a minimal DOM/HA runtime.
// A removed input (e.g. #base from v1.0.0) must never crash card initialization.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const src = fs.readFileSync(
  path.join(__dirname, "../custom_components/mittelhof_inventory/frontend/mittelhof-inventory-card.js"), "utf8"
).replace(/^import [^\n]+\n/gm, "");
class FakeElement {
  constructor(tag = "div") {
    this.tagName = tag;
    this._html = "";
    this._elements = new Map();
    this.value = "";
    this.style = {};
    this.dataset = {};
    this.firstChild = {textContent:""};
    this.selectedOptions = [];
    this.children = [];
    this.textContent = "";
  }
  set innerHTML(value) { this._html = value; this._elements.clear(); }
  get innerHTML() { return this._html; }
  querySelector(sel) {
    if(!sel.startsWith("#")) return null;
    const id=sel.slice(1);
    // A DOM element exists only if it was actually rendered with that ID.
    if(!this._html.includes('id="' + id + '"')) return null;
    if(!this._elements.has(id)) this._elements.set(id, new FakeElement(id));
    return this._elements.get(id);
  }
  querySelectorAll() { return []; }
  replaceChildren(...args) { this.children = [...args]; }
  appendChild(node) { this.children.push(node); return node; }
  append(...nodes) { this.children.push(...nodes); }
  add(opt) { this.children.push(opt); }
  addEventListener() {}
}
const cards = new Map();
const win = {
  location: {origin:"http://local.homeassistant.test:8123", search:""},
  customCards: [],
};
const doc = {createElement(tag){return new FakeElement(tag);}};
const ctx = {
  HTMLElement:FakeElement,
  window:win,
  document:doc,
  URL, URLSearchParams, Math, Number, JSON, String, Array, Object,
  Option:class { constructor(label,value){this.label=label;this.value=value;} },
  customElements:{
    get(name){return cards.get(name);},
    define(name,ctor){cards.set(name,ctor);}
  },
  console,
};
vm.runInNewContext(src,ctx,{filename:"mittelhof-inventory-card.js"});
const blank = {items:[],locations:[],stock:[],suggestions:[],policies:[],categories:[],areas:[]};
async function main(){
  const results=[];
  for(const [name,constructor] of cards){
    const card = new constructor();
    card.setConfig({});
    card.hass = {
      states: {},
      connection:{sendMessagePromise:async()=>blank},
    };
    await Promise.resolve();
    await Promise.resolve();
    results.push(name);
    if(name==="mittelhof-inventory-admin"){
      assert.ok(card.querySelector("#edit-category"));
      assert.ok(card.querySelector("#manufacturer"));
      // Removed v1.0.0 QR generator: no #base field must be required.
      assert.equal(card.querySelector("#base"),null);
    }
  }
  assert.ok(results.includes("mittelhof-inventory-structure-admin"));
  assert.ok(results.includes("mittelhof-inventory-area-capture"));
  assert.ok(results.includes("mittelhof-inventory-admin"));
  console.log("All dashboard card initialization checks passed:",results.join(", "));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
