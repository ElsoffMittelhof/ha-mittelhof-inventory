// Regression for v2 frontend: one article summed across independent physical areas.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname,
  "../custom_components/mittelhof_inventory/frontend/mittelhof-inventory-card.js"),"utf8");
assert.ok(source.includes("inventory_instance"),"QR must reference the physical instance");
assert.ok(!source.includes("inventory_area="),"Obsolete v1 URL found");
assert.ok(!source.includes("idempotency_key:crypto.randomUUID()"));
const start=source.indexOf("function aggregate(");
const end=source.indexOf("class Base extends",start);
assert.ok(start>=0&&end>start);
const aggregate=vm.runInNewContext(source.slice(start,end)+"\naggregate",{
  Map,Set,Array,Number
});
const item={id:"fork",sku:"A-000001",name:"Gabel",unit:"Stück",category_id:"cutlery"};
const stock=[
  {item_id:"fork",instance_id:"drawer13",location_id:"13",counted:true,quantity:8},
  {item_id:"fork",instance_id:"drawer14",location_id:"14",counted:true,quantity:8},
  {item_id:"fork",instance_id:"reserve13",location_id:"13",counted:true,quantity:5},
  {item_id:"fork",instance_id:"drawer15",location_id:"15",counted:false,quantity:null},
];
const data={items:[item],stock};
assert.equal(aggregate(data,new Set(["13"]),"cutlery")[0].count,13);
assert.equal(aggregate(data,new Set(["13","14"]),"cutlery")[0].count,21);
assert.equal(aggregate(data,new Set(["13","14","15"]),"cutlery")[0].unknown,1);
assert.equal(aggregate(data,new Set(["13"]),"other").length,0);
assert.equal(aggregate(data,new Set(),"cutlery").length,0);
console.log("v2 area aggregation and QR target passed");
