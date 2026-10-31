import React,{useRef,useState}from"react";
import{createRoot}from"react-dom/client";
import{Upload,FileSpreadsheet,Download,CheckCircle2,AlertTriangle,LoaderCircle,ShieldCheck,RefreshCw,Database}from"lucide-react";
import*as XLSX from"xlsx-js-style";import Papa from"papaparse";import"./style.css";
const AGING=["0 days","1 days","2 days","3 days","4 days","5 days",">5 days"];
function App(){
 const input=useRef(null),[file,setFile]=useState(null),[status,setStatus]=useState("idle"),[progress,setProgress]=useState(0),[result,setResult]=useState(null),[error,setError]=useState(""),[warnings,setWarnings]=useState([]),[rawParts,setRawParts]=useState([]),[drag,setDrag]=useState(false),[exporting,setExporting]=useState(false);
 function choose(f){if(!f)return;setError("");setResult(null);setWarnings([]);setRawParts([]);if(!/\.csv$/i.test(f.name)){setError("Please upload a CSV projection file (.csv).");return;}setFile(f);setStatus("ready");}
 function process(){if(!file)return;setStatus("processing");setProgress(0);setError("");setRawParts([]);const w=new Worker(new URL("./worker.js",import.meta.url),{type:"module"});w.onmessage=e=>{const m=e.data;if(m.type==="progress")setProgress(m.value);if(m.type==="raw"){setRawParts(prev=>[...prev,m.chunk]);}if(m.type==="done"){setResult(m.result);setWarnings(m.result.warnings);setProgress(100);setStatus("done");w.terminate();}if(m.type==="error"){setError(m.message);setStatus("error");w.terminate();}};w.onerror=()=>{setError("CSV processing failed. Try a smaller file or check the CSV encoding.");setStatus("error");w.terminate();};w.postMessage({file});}
 function downloadReport(){
  if(exporting)return;
  setExporting(true);setError("");
  try{
   const reportRows=[["remark","sr",...AGING,"Grand Total"],...result.reportRows.map(r=>[r.remark,r.sr,...AGING.map(a=>r.counts[a]||""),r.total||""])];
   const reportWs=XLSX.utils.aoa_to_sheet(reportRows);
   reportWs["!cols"]=[{wch:16},{wch:48},...AGING.map(()=>({wch:12})),{wch:15}];
   reportWs["!freeze"]={xSplit:2,ySplit:1};
   reportWs["!autofilter"]={ref:`A1:J${reportRows.length}`};
   const headerStyle={font:{bold:true,color:{rgb:"FFFFFF"}},fill:{fgColor:{rgb:"203B61"}},alignment:{horizontal:"center",vertical:"center"},border:{bottom:{style:"thin",color:{rgb:"9DB4D0"}}}};
   const subtotalStyle={font:{bold:true,color:{rgb:"172C49"}},fill:{fgColor:{rgb:"DCEAF8"}},alignment:{vertical:"center"}};
   for(let c=0;c<10;c++){const cell=XLSX.utils.encode_cell({r:0,c});if(reportWs[cell])reportWs[cell].s=headerStyle;}
   result.reportRows.forEach((r,i)=>{if(r.isSubtotal||r.isGrand){for(let c=0;c<10;c++){const cell=XLSX.utils.encode_cell({r:i+1,c});if(reportWs[cell])reportWs[cell].s=subtotalStyle;}}});
   reportWs["!rows"]=[{hpt:24},...result.reportRows.map(r=>({hpt:r.isSubtotal||r.isGrand?21:18}))];
   const wb=XLSX.utils.book_new();
   XLSX.utils.book_append_sheet(wb,reportWs,"Morning Aging Report");
   const rawWs={};
   let rawRow=0,rawBatch=[];
   const finish=()=>{
    if(rawBatch.length){XLSX.utils.sheet_add_aoa(rawWs,rawBatch,{origin:rawRow});rawRow+=rawBatch.length;rawBatch=[];}
    rawWs["!cols"]=(result.rawHeaders||[]).map(h=>({wch:Math.min(32,Math.max(14,String(h).length+2))}));
    rawWs["!freeze"]={xSplit:0,ySplit:1};
    if(rawRow>0)rawWs["!autofilter"]={ref:XLSX.utils.encode_range({s:{r:0,c:0},e:{r:rawRow-1,c:(result.rawHeaders||[]).length-1}})};
    const rawHeader=result.rawHeaders||[];
    rawHeader.forEach((_,c)=>{const cell=XLSX.utils.encode_cell({r:0,c});if(rawWs[cell])rawWs[cell].s=headerStyle;});
    XLSX.utils.book_append_sheet(wb,rawWs,"Processed Data");
    const filename=file.name.replace(/\.csv$/i,"")+"_Morning_Aging_Report.xlsx";
    XLSX.writeFile(wb,filename,{compression:true,cellStyles:true});
    setExporting(false);
   };
   const rawBlob=new Blob(rawParts,{type:"text/csv;charset=utf-8"});
   Papa.parse(rawBlob,{worker:true,header:false,skipEmptyLines:false,step:(parsed)=>{
    rawBatch.push(parsed.data);
    if(rawBatch.length>=1500){XLSX.utils.sheet_add_aoa(rawWs,rawBatch,{origin:rawRow});rawRow+=rawBatch.length;rawBatch=[];}
   },complete:finish,error:(err)=>{setError("Processed data sheet could not be created: "+err.message);setExporting(false);}});
  }catch(e){setError("Combined Excel export failed. "+(e?.message||""));setExporting(false);}
 }

 const size=b=>b<1048576?(b/1024).toFixed(1)+" KB":(b/1048576).toFixed(1)+" MB";
 return <main className="shell"><header><div className="brand"><div className="logo"><FileSpreadsheet/></div><div><b>MORNING AGING</b><small>REPORT GENERATOR</small></div></div><span className="local">● LOCAL PROCESSING</span></header>
 <section className="hero"><label>AUTOMATED CSV WORKFLOW</label><h1>Your Morning Aging Report.<br/><em>Without the manual work.</em></h1><p>Upload your CSV projection. The browser applies only your agreed remark changes and generates the aging summary.</p></section>
 <section className="panel"><div className={"drop "+(drag?"drag":"")} onDragOver={e=>{e.preventDefault();setDrag(true)}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);choose(e.dataTransfer.files[0])}}><input ref={input} hidden type="file" accept=".csv,text/csv" onChange={e=>choose(e.target.files[0])}/><div className="up"><Upload size={26}/></div><h2>Upload projection CSV</h2><p>Drag and drop your CSV file here, or choose from your computer.</p><button className="secondary" onClick={()=>input.current.click()}>Choose CSV file</button><small>CSV only · Files are processed locally in your browser</small></div>
 {file&&<div className="file"><FileSpreadsheet/><div><b>{file.name}</b><small>{size(file.size)}</small></div><button className="secondary" onClick={()=>{setFile(null);setResult(null);setStatus("idle");setRawParts([]);}}>Change</button></div>}
 {file&&status!=="processing"&&status!=="done"&&<button className="primary" onClick={process}><Database size={17}/> Process CSV data</button>}
 {status==="processing"&&<div className="progress"><b><LoaderCircle className="spin"/> Processing CSV</b><strong>{progress}%</strong><div><i style={{width:progress+"%"}}/></div><small>Keep this tab open. Large files may take a few minutes.</small></div>}
 {error&&<div className="error"><AlertTriangle/>{error}</div>}
 {result&&<div className="results"><div className="success"><CheckCircle2/><div><b>Report generated successfully</b><small>Processed {result.totalRows.toLocaleString("en-IN")} CSV records.</small></div></div><div className="stats"><div><small>Total records</small><b>{result.totalRows.toLocaleString("en-IN")}</b></div><div><small>Waybills counted</small><b>{result.counted.toLocaleString("en-IN")}</b></div><div><small>Unmapped aging</small><b>{result.unmappedAging.toLocaleString("en-IN")}</b></div></div><div className="stats buckets">{["OPS","CS","Security"].map(k=><div key={k}><small>{k}</small><b>{(result.bucketTotals[k]||0).toLocaleString("en-IN")}</b></div>)}</div>
 {warnings.length>0&&<div className="warning"><AlertTriangle/><div><b>Review items</b><ul>{warnings.map((x,i)=><li key={i}>{x}</li>)}</ul></div></div>}
 <div className="preview"><div className="previewhead"><b>PivotTable preview</b><small>First 18 rows</small></div><div className="tablebox"><table><thead><tr><th>Remark</th><th>SR</th>{AGING.map(a=><th key={a}>{a}</th>)}<th>Total</th></tr></thead><tbody>{result.reportRows.slice(0,18).map((r,i)=><tr className={r.isSubtotal||r.isGrand?"subtotal":""} key={i}><td>{r.remark}</td><td>{r.sr}</td>{AGING.map(a=><td key={a}>{r.counts[a]||""}</td>)}<td>{r.total}</td></tr>)}</tbody></table></div></div>
 <button className="download" onClick={downloadReport} disabled={exporting}><Download size={18}/> {exporting?"Preparing combined Excel workbook…":"Download Complete Excel (Report + Data)"}</button><p className="note">One Excel file contains two worksheets: Morning Aging Report and Processed Data. Large files may take extra time to export.</p></div>}</section>
 <section className="rules"><h3><ShieldCheck/> PROCESSING RULES</h3><div><p><b>01 / Waybill cleanup</b><br/>Remove comma, backtick and apostrophe characters without converting waybills to numbers.</p><p><b>02 / Remark changes only</b><br/>Apply only the SR-to-remark changes you specified. Preserve other existing remarks.</p><p><b>03 / Pivot summary</b><br/>Remark subtotal rows, blank remark cells for SR details, aging counts and Grand Total.</p><p><b>04 / Validation</b><br/>Flag blank or unrecognized aging buckets and show count reconciliation.</p></div></section>
 <footer><span>Morning Aging Report Generator</span><span>CSV stays on your device · No server upload</span></footer></main>
}
createRoot(document.getElementById("root")).render(<App/>);