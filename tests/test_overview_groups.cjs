// Verifies that the overview includes only selected sites, their active
// stocktake areas and articles specifically assigned to those sites.
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const js=fs.readFileSync(path.join(__dirname,"../custom_components/mittelhof_inventory/frontend/mittelhof-inventory-card.js"),"utf8");
const start=js.indexOf("function buildOverviewGroups(");
const end=js.indexOf("class InventoryOverview ",start);
assert.ok(start>0&&end>start);
const build=vm.runInNewContext(js.slice(start,end)+"\nbuildOverviewGroups",{
  Set,Map,Number,Array,Math
});
const locations=[
  {id:"13",name:"Haus 13"},
  {id:"14",name:"Haus 14"},
  {id:"garage",name:"Garage 1"}
];
const categories=[{id:"besteck",name:"Besteck"},{id:"werkzeug",name:"Werkzeug"}];
const items=[
  {id:"gabel",sku:"A-000001",name:"Gabel",unit:"Stück",location_ids:["13","14"]},
  {id:"messer",sku:"A-000002",name:"Messer",unit:"Stück",location_ids:["13"]},
  {id:"hammer",sku:"A-000003",name:"Hammer",unit:"Stück",location_ids:["garage"]},
  {id:"unassigned",sku:"A-000004",name:"Nicht im Bereich",unit:"Stück",location_ids:["13"]},
  {id:"invalid",sku:"A-000005",name:"Nicht am Standort",unit:"Stück",location_ids:["14"]},
];
const areas=[
  {id:"a1",name:"Besteckschublade",category_id:"besteck",location_id:"13",
    item_ids:["messer","gabel","gabel","invalid"],active:true},
  {id:"a2",name:"Besteckschublade",category_id:"besteck",location_id:"14",
    item_ids:["gabel"],active:true},
  {id:"a3",name:"Werkzeugschrank",category_id:"werkzeug",location_id:"garage",
    item_ids:["hammer"],active:true},
  {id:"inactive",name:"Altes Regal",category_id:"werkzeug",location_id:"13",
    item_ids:["hammer"],active:false},
];
const stock=[
  {item_id:"gabel",location_id:"13",quantity:8,counted:true},
  {item_id:"messer",location_id:"13",quantity:0,counted:true},
  {item_id:"gabel",location_id:"14",quantity:9,counted:false},
  {item_id:"hammer",location_id:"garage",quantity:1,counted:true}
];
let groups=build(items,locations,stock,areas,categories,new Set(["13"]));
assert.equal(groups.length,1);
assert.equal(groups[0].name,"Haus 13");
assert.equal(groups[0].groups.length,1,"inactive areas excluded");
assert.equal(groups[0].groups[0].name,"Besteckschublade");
assert.equal(groups[0].groups[0].category,"Besteck");
assert.equal(groups[0].groups[0].rows.length,2,"only assigned area members, no duplicates");
assert.equal(groups[0].groups[0].counted,2,"explicit zero counts as counted");
assert.equal(groups[0].groups[0].total,8);
assert.ok(groups[0].groups[0].rows.some(x=>x.name==="Messer"&&x.quantity===0));
assert.ok(!groups[0].groups[0].rows.some(x=>x.name==="Nicht im Bereich"));
groups=build(items,locations,stock,areas,categories,new Set(["13","garage"]));
assert.equal(groups.length,2);
assert.equal(groups[1].groups[0].rows[0].name,"Hammer");
groups=build(items,locations,stock,areas,categories,new Set(["14"]));
assert.equal(groups[0].groups[0].rows.length,1);
assert.equal(groups[0].groups[0].rows[0].counted,false);
assert.equal(groups[0].groups[0].uncounted,1);
groups=build(items,locations,stock,areas,categories,new Set());
assert.equal(groups.length,0);

// Destructive actions must use a single dialog, never typed confirmations.
// Backend still expects a server-validated confirmation token and admin login.
assert.ok(!js.includes("window.prompt("));
for(const id of ["category-confirm","area-confirm","location-confirm"])
  assert.ok(!js.includes('id="'+id+'"'));
for(const name of ["deleteCategory","deleteArea","deleteLocation","removeItem","resetStock"])
  assert.ok(js.includes(name+"()"));
assert.ok(js.includes("window.confirm("));

console.log("Dynamic multi-site area overview and dialog-only deletion checks passed");
