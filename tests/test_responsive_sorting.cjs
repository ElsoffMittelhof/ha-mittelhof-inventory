// v2.1.1 regression: German sorting in ALL shared dropdowns and checkbox lists,
// preserving selected IDs and responsive mobile/desktop card styles.
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,
  "../custom_components/mittelhof_inventory/frontend/mittelhof-inventory-card.js"),"utf8");
const a=source.indexOf("const germanSort=");
const b=source.indexOf("function serial(",a);
assert.ok(a>0&&b>a,"shared sorting helper not found");
class Option{
  constructor(label,value){this.label=label;this.value=value;}
}
const helpers=vm.runInNewContext(source.slice(a,b)+
  "\n({alphabetical,options})",{Intl,Option});
const names=[
  {id:"h10",name:"Haus 10"},
  {id:"g1",name:"Garage 1"},
  {id:"h2",name:"Haus 2"},
  {id:"a",name:"Äpfel"},
];
assert.deepEqual(Array.from(helpers.alphabetical(names),x=>x.id),
  ["a","g1","h2","h10"]);
assert.deepEqual(names.map(x=>x.id),["h10","g1","h2","a"],
  "sorting must not mutate HA snapshot ordering");

class Select{
  constructor(){this.dataset={};this.value="";this.values=[];}
  replaceChildren(option){this.values=[option];}
  add(option){this.values.push(option);}
}
const select=new Select();
helpers.options(select,names,"Standort wählen");
assert.deepEqual(select.values.map(x=>x.label),
  ["Standort wählen","Äpfel","Garage 1","Haus 2","Haus 10"]);
select.value="h10";
helpers.options(select,[...names,{id:"b",name:"Besteck"}],"Standort wählen");
assert.equal(select.value,"h10","dropdown must retain selected item after data changes");
assert.deepEqual(select.values.map(x=>x.label),
  ["Standort wählen","Äpfel","Besteck","Garage 1","Haus 2","Haus 10"]);

const ca=source.indexOf("function checkList(");
const cb=source.indexOf("function chosen(",ca);
assert.ok(ca>=0&&cb>ca);
const dom=(tag,text,parent)=>{
  const el={tag,children:[],value:"",checked:false,
    append(value){this.children.push({tag:"text",text:value});}};
  if(parent)parent.children.push(el);
  return el;
};
const checkList=vm.runInNewContext(source.slice(ca,cb)+"\ncheckList",{
  alphabetical:helpers.alphabetical,dom
});
const root={children:[],replaceChildren(){this.children=[];}};
checkList(root,names,["h10","a"]);
assert.deepEqual(root.children.map(label=>label.children[0].value),
  ["a","g1","h2","h10"]);
assert.deepEqual(root.children.filter(label=>label.children[0].checked)
  .map(label=>label.children[0].value),["a","h10"]);
assert.ok(source.includes('ha-card{display:block;box-sizing:border-box;width:100%;max-width:1480px;margin-inline:auto}'));
assert.ok(source.includes('@media(min-width:960px)'));
assert.ok(source.includes('grid-template-columns:repeat(auto-fit,minmax(140px,1fr))'),
  "old mobile checkbox layout must remain");
console.log("Alphabetical dropdown/checkbox sorting and responsive CSS verified");
