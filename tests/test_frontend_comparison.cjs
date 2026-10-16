// v2.1 regression: logical area comparison across multiple physical instances
// and preserving hidden assignments while filtering by selected categories.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname,
  "../custom_components/mittelhof_inventory/frontend/mittelhof-inventory-card.js"), "utf8");
const extract=(start,finish,name,context={})=>{
  const a=source.indexOf(start),b=source.indexOf(finish,a+start.length);
  assert.ok(a>=0 && b>a,"Could not find function "+name);
  return vm.runInNewContext(source.slice(a,b)+"\n"+name,
    {Map,Set,Array,Number,...context});
};
const compareAreas=extract("function compareAreas(","function matchingCategoryItems(","compareAreas");
const matchingCategoryItems=extract("function matchingCategoryItems(","function changeAssignmentDraft(","matchingCategoryItems");
const changeAssignmentDraft=extract("function changeAssignmentDraft(","class Base extends","changeAssignmentDraft");
const locations=[
  {id:"13",name:"Ferienhaus 13"},{id:"14",name:"Ferienhaus 14"},
  {id:"15",name:"Ferienhaus 15"}
];
const templates=[{id:"cutlery",name:"Besteckschublade"},{id:"tools",name:"Werkstatt"}];
const instances=[
  {id:"a13",location_id:"13",template_id:"cutlery"},
  {id:"b13",location_id:"13",template_id:"cutlery",label:"Reserve"},
  {id:"a14",location_id:"14",template_id:"cutlery"},
  {id:"a15",location_id:"15",template_id:"cutlery"},
  {id:"tools13",location_id:"13",template_id:"tools"}
];
const items=[
  {id:"fork",name:"Gabel",unit:"Stück",category_id:"cutlery"},
  {id:"knife",name:"Messer",unit:"Stück",category_id:"cutlery"},
  {id:"spoon",name:"Löffel",unit:"Stück",category_id:"cutlery"},
  {id:"glass",name:"Glas",unit:"Stück",category_id:"glass"},
];
const stock=[
  {item_id:"fork",instance_id:"a13",counted:true,quantity:8},
  {item_id:"fork",instance_id:"b13",counted:true,quantity:2},
  {item_id:"fork",instance_id:"a14",counted:true,quantity:8},
  {item_id:"fork",instance_id:"a15",counted:true,quantity:10},
  {item_id:"knife",instance_id:"a13",counted:true,quantity:4},
  {item_id:"spoon",instance_id:"a13",counted:true,quantity:0},
  {item_id:"spoon",instance_id:"a14",counted:true,quantity:0},
  {item_id:"spoon",instance_id:"a15",counted:true,quantity:0},
  {item_id:"glass",instance_id:"a14",counted:false,quantity:null}
];
const d={locations,templates,instances,items,stock};
let result=compareAreas(d,"cutlery",new Set(["13","14","15"]));
assert.equal(result.columns.length,3);
let rows=new Map(result.rows.map(x=>[x.item.id,x]));
assert.equal(rows.get("fork").cells[0].quantity,10,"two physical drawers in one house must sum");
assert.equal(rows.get("fork").status,"different");
assert.equal(rows.get("fork").reason,"Mengenabweichung");
assert.equal(rows.get("knife").status,"missing");
assert.match(rows.get("knife").reason,/Ferienhaus 13/);
assert.equal(rows.get("spoon").status,"equal","counted zero is a known quantity");
assert.equal(rows.get("glass").status,"incomplete","uncounted is not zero");
assert.equal(rows.get("glass").cells[1].state,"uncounted");
result=compareAreas(d,"cutlery",new Set(["13","14","15"]),"cutlery");
assert.equal(result.rows.length,3,"comparison category filter must work");
const without15={...d,instances:instances.filter(x=>x.id!=="a15")};
const missing=compareAreas(without15,"cutlery",new Set(["13","14","15"]));
assert.equal(missing.rows.find(x=>x.item.id==="fork").cells[2].state,"area_missing");
assert.equal(missing.rows.find(x=>x.item.id==="fork").status,"area_missing");
// Filtering down to "Besteck" must not remove already assigned articles from other categories.
const assignmentItems=[
  {id:"fork",name:"Gabel",sku:"A-000001",category_id:"cutlery"},
  {id:"glass",name:"Glas",sku:"A-000002",category_id:"glass"},
  {id:"knife",name:"Messer",sku:"A-000003",category_id:"cutlery"},
];
const visible=matchingCategoryItems(assignmentItems,new Set(["cutlery"]));
assert.deepEqual(Array.from(visible,x=>x.name),["Gabel","Messer"]);
let draft=new Set(["glass"]);
draft=changeAssignmentDraft(draft,"fork",true);
assert.ok(draft.has("glass"),"hidden assignment must survive edits to visible categories");
draft=changeAssignmentDraft(draft,"fork",false);
assert.ok(draft.has("glass"));
assert.equal(draft.has("fork"),false);
assert.ok(source.includes("item_ids=[...this._assignmentDraft]"),"save must send full draft, not only visible checkboxes");
const admin=source.slice(source.indexOf("  render_instance_items(){"),source.indexOf("  createCategory(){"));
assert.ok(admin.includes('label.append(" "+item.name+'));
assert.ok(!admin.includes("item.sku"),"assignment labels must not expose SKU");
console.log("Comparison matrix and category-filtered safe assignments passed");
