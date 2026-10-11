// Regression: locally bundled QR generator and QR decoder round-trip without network.
const assert=require("node:assert/strict");
const path=require("node:path");
const vend=path.join(__dirname,"../custom_components/mittelhof_inventory/frontend/vendor");
const qrgen=require(path.join(vend,"qrgen.js"));
const jsQR=require(path.join(vend,"jsQR.js"));
const url="https://ha.example.invalid/inventar-dashboard/erfassung?inventory_area=besteckschublade-13";
const qr=qrgen.QrCode.encodeText(url,qrgen.QrCode.Ecc.HIGH);
const quiet=4,px=7,modules=qr.size+2*quiet,side=modules*px;
const bitmap=new Uint8ClampedArray(side*side*4);
for(let y=0;y<side;y++)for(let x=0;x<side;x++){
  const mx=Math.floor(x/px)-quiet, my=Math.floor(y/px)-quiet;
  const dark=mx>=0&&my>=0&&mx<qr.size&&my<qr.size&&qr.getModule(mx,my);
  const c=dark?0:255,at=4*(y*side+x);
  bitmap[at]=c;bitmap[at+1]=c;bitmap[at+2]=c;bitmap[at+3]=255;
}
const found=jsQR(bitmap,side,side,{inversionAttempts:"attemptBoth"});
assert.equal(found?.data,url,"Generated combination link must be decoded offline");
console.log("Area QR roundtrip passed");
