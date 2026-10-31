import Papa from "papaparse";
const AGING=["0 days","1 days","2 days","3 days","4 days","5 days",">5 days"];
const OPS=new Set(["added to bag","re-attempt at rcn"]);
const CS=new Set(["on hold. finance embargo","on hold. recipient unable to accept delivery","seller/cwh permanently closed","brand box"]);
const SEC=new Set(["package missing in audit","short bag","short shipment","under security investigation","barcode/qr mismatch"]);
const norm=v=>String(v??"").trim().replace(/\s+/g," ");
const key=v=>norm(v).toLowerCase();
function age(v){
 const x=key(v);
 return ({"0":"0 days","0 day":"0 days","0 days":"0 days","1":"1 days","1 day":"1 days","1 days":"1 days","2":"2 days","2 day":"2 days","2 days":"2 days","3":"3 days","3 day":"3 days","3 days":"3 days","4":"4 days","4 day":"4 days","4 days":"4 days","5":"5 days","5 day":"5 days","5 days":"5 days",">5 days":">5 days","> 5 days":">5 days","more than 5 days":">5 days"})[x]||null;
}
function cleanWaybill(v){return norm(v).replace(/[`',]/g,"").trim();}
function assignRemark(sr,old){
 const s=key(sr),v=norm(old);
 if(OPS.has(s))return "OPS";
 if(CS.has(s))return "CS";
 if(SEC.has(s))return "Security";
 if(/^ops$/i.test(v))return "OPS";
 if(/^cs$/i.test(v))return "CS";
 if(/^security$/i.test(v))return "Security";
 return v;
}
const send=(type,data={})=>self.postMessage({type,...data});
self.onmessage=({data})=>{
 try{
  const file=data.file;
  let headers=null,idx=null,ri=null,wi=null,si=null,ai=null,rowCount=0,counted=0,unmapped=0,empty=0,rawBatch=[],failed=false;
  const groups=new Map(),totals={OPS:0,CS:0,Security:0},warnings=[];
  const flush=()=>{if(rawBatch.length){send("raw",{chunk:rawBatch.join("")});rawBatch=[];}};
  Papa.parse(file,{
   header:true,skipEmptyLines:"greedy",worker:false,
   step:(parsed,parser)=>{
    const obj=parsed.data;
    if(!headers){
     headers=(parsed.meta.fields||[]).map(h=>String(h).replace(/^\uFEFF/,""));
     idx=new Map(headers.map(h=>[key(h),h]));
     const missing=["waybill_number","sr","center_aging_bucket"].filter(k=>!idx.has(k));
     if(missing.length){failed=true;send("error",{message:"Missing required CSV column(s): "+missing.join(", ")});parser.abort();return;}
     wi=idx.get("waybill_number");si=idx.get("sr");ai=idx.get("center_aging_bucket");
     ri=idx.has("remark")?idx.get("remark"):"remark";
     if(!idx.has("remark"))headers.push("remark");
     rawBatch.push(Papa.unparse([headers],{header:false})+"\r\n");
    }
    rowCount++;
    const wb=cleanWaybill(obj[wi]);obj[wi]=wb;
    const sr=norm(obj[si]);
    const rm=assignRemark(sr,obj[ri]||"");obj[ri]=rm;
    if(!wb)empty++;
    else{
     counted++;
     const a=age(obj[ai]);
     if(!a)unmapped++;
     else{
      if(Object.prototype.hasOwnProperty.call(totals,rm))totals[rm]++;
      const k=rm+"\u0000"+sr;
      if(!groups.has(k))groups.set(k,{remark:rm,sr,counts:Object.fromEntries(AGING.map(x=>[x,0])),total:0});
      groups.get(k).counts[a]++;groups.get(k).total++;
     }
    }
    rawBatch.push(Papa.unparse([headers.map(h=>obj[h]??"")],{header:false})+"\r\n");
    if(rawBatch.length>=2000)flush();
    if(rowCount%10000===0)send("progress",{value:Math.min(94,Math.round(rowCount/(rowCount+50000)*94))});
   },
   complete:()=>{
    if(failed)return;
    flush();
    const by=new Map();
    for(const g of groups.values()){if(!by.has(g.remark))by.set(g.remark,[]);by.get(g.remark).push(g);}
    const primary=["OPS","CS","Security"],other=[...by.keys()].filter(x=>!primary.includes(x)).sort(),reportRows=[];
    const grand={remark:"Grand Total",sr:"",counts:Object.fromEntries(AGING.map(x=>[x,0])),total:0,isGrand:true};
    for(const rm of [...primary.filter(x=>by.has(x)),...other]){
     const details=by.get(rm).sort((a,b)=>a.sr.localeCompare(b.sr));
     const sub={remark:rm,sr:"",counts:Object.fromEntries(AGING.map(x=>[x,0])),total:0,isSubtotal:true};
     reportRows.push(sub);
     for(const g of details){
      reportRows.push({...g,remark:""});
      for(const a of AGING){sub.counts[a]+=g.counts[a];grand.counts[a]+=g.counts[a];}
      sub.total+=g.total;grand.total+=g.total;
     }
    }
    reportRows.push(grand);
    if(unmapped)warnings.push(`${unmapped.toLocaleString("en-IN")} waybills have blank/unrecognized center_aging_bucket; excluded from aging totals.`);
    if(empty)warnings.push(`${empty.toLocaleString("en-IN")} rows have empty waybill_number and were not counted.`);
    if(other.length)warnings.push("Other existing remark groups preserved: "+other.slice(0,10).join(", "));
    send("progress",{value:100});
    send("done",{result:{totalRows:rowCount,counted,unmappedAging:unmapped,bucketTotals:totals,reportRows,warnings,rawHeaders:headers}});
   },
   error:err=>send("error",{message:err?.message||"CSV parsing failed."})
  });
 }catch(e){send("error",{message:e.message||"Processing failed."});}
};
