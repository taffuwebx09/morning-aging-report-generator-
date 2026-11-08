import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  UploadCloud, FileSpreadsheet, Download, CheckCircle2, AlertTriangle,
  LoaderCircle, ShieldCheck, RefreshCw, LockKeyhole, Wifi, HardDrive,
  Zap, Brush, Repeat2, BarChart3, Headphones
} from "lucide-react";
import "./style.css";

const API = "http://127.0.0.1:47831";
const TOKEN_KEY = "morning-aging-processor-token";
const AGING = ["0 days", "1 days", "2 days", "3 days", "4 days", "5 days", ">5 days"];

// Local companion service runs only on this PC. Trigger the browser's loopback
// permission from a user-click action (Connect / Process), never on page load.
function localFetch(url, options = {}) {
  const request = new Request(url, { ...options, targetAddressSpace: "loopback", mode: "cors" });
  return fetch(request);
}

function prettySize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function App() {
  const picker = useRef(null);
  const poll = useRef(null);
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => () => { if (poll.current) clearTimeout(poll.current); }, []);

  async function connect() {
    const key = token.trim();
    if (!key) {
      setError("Processor terminal se local key copy karke yahan paste karo.");
      return;
    }
    setConnecting(true);
    setError("");
    setConnected(false);
    try {
      const health = await localFetch(`${API}/api/health`, { cache: "no-store" });
      if (!health.ok) throw new Error("Local processor se response nahi mila.");
      const response = await localFetch(`${API}/api/verify`, {
        headers: { "X-Processor-Token": key },
        cache: "no-store"
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Local processor key incorrect hai.");
      localStorage.setItem(TOKEN_KEY, key);
      setToken(key);
      setConnected(true);
    } catch (e) {
      setConnected(false);
      const message = e?.message || "";
      setError(message.includes("Failed to fetch")
        ? "Processor connect nahi hua. `npm run processor` terminal mein running rakho. Browser Local Network / Loopback permission maange toh Allow karo."
        : message);
    } finally {
      setConnecting(false);
    }
  }

  function chooseFile(next) {
    setError("");
    setJob(null);
    if (!next) return;
    if (!/\.csv$/i.test(next.name)) {
      setFile(null);
      setStatus("idle");
      setError("Please projection CSV file upload karo (.csv).");
      return;
    }
    setFile(next);
    setStatus("ready");
    setProgress(0);
  }

  async function refreshJob(id) {
    const response = await localFetch(`${API}/api/jobs/${encodeURIComponent(id)}`, {
      headers: { "X-Processor-Token": token },
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Processing status read nahi ho saka.");
    setJob(data);
    setProgress(data.progress || 0);
    setStage(data.stage || "");
    if (data.status === "completed") {
      setStatus("done");
      return;
    }
    if (data.status === "error") {
      setStatus("error");
      throw new Error(data.error || "CSV processing fail hui.");
    }
    setStatus("processing");
    poll.current = setTimeout(() => refreshJob(id).catch(e => {
      setStatus("error");
      setError(e.message || "Job status read failed.");
    }), 1200);
  }

  function startProcessing() {
    if (!connected) {
      setError("Pehle local processor connect karo.");
      return;
    }
    if (!file) {
      setError("Pehle CSV file select karo.");
      return;
    }
    if (poll.current) clearTimeout(poll.current);
    setError("");
    setJob(null);
    setStatus("uploading");
    setUploadProgress(0);
    setStage("Uploading CSV to your own laptop");

    const body = new FormData();
    body.append("file", file, file.name);
    setUploadProgress(10);
    localFetch(`${API}/api/jobs`, {
      method: "POST",
      headers: { "X-Processor-Token": token },
      body
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.jobId) {
        throw new Error(data.error || `Upload failed: HTTP ${response.status}`);
      }
      setUploadProgress(100);
      setStage("Upload complete. Streaming CSV processing started.");
      return refreshJob(data.jobId);
    }).catch((e) => {
      setStatus("error");
      setError(e.message || "CSV upload/processing could not start.");
    });
  }

  async function downloadWorkbook() {
    if (!job?.id) return;
    setError("");
    try {
      const response = await localFetch(`${API}/api/jobs/${encodeURIComponent(job.id)}/ticket`, {
        method: "POST",
        headers: { "X-Processor-Token": token }
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.url) throw new Error(body.error || "Download link could not be created.");
      const anchor = document.createElement("a");
      anchor.href = body.url;
      anchor.download = job.filename || "Morning_Aging_Report.xlsx";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setStage("Download started. Local processor terminal open rakho jab tak file complete download na ho.");
    } catch (e) {
      setError(e.message || "Download start nahi ho saka.");
    }
  }

  function disconnect() {
    setConnected(false);
    localStorage.removeItem(TOKEN_KEY);
    setToken("");
  }

  const preview = job?.reportPreview || [];

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon"><BarChart3 size={24} /></div>
          <div><b>Morning Aging</b><span>Report Generator</span></div>
        </div>
        <div className={`pill ${connected ? "online" : "offline"}`}><i />{connected ? "Local Processor Connected" : "Local Processor Offline"}</div>
        <a className="help" href="#help"><Headphones size={16} /> Help</a>
      </header>

      <section className="hero">
        <div className="eyebrow"><Zap size={14} /> STREAMING CSV WORKFLOW</div>
        <h1>Morning Aging Report Generator</h1>
        <p>Upload your CSV projection. Get cleaned processed data and a ready-to-use aging report in <strong>one Excel file</strong>.</p>
      </section>

      <section className="upload-card">
        <aside className="side">
          <div className="feature green"><FileSpreadsheet size={26} /></div>
          <h3>One Excel File</h3>
          <p>Report + complete processed data in one workbook.</p>
        </aside>

        <div className="center">
          <div className="processor">
            <div className={`processor-icon ${connected ? "ok" : ""}`}>{connected ? <Wifi /> : <HardDrive />}</div>
            <div><b>{connected ? "Your laptop is connected" : "Connect your local processor"}</b><span>{connected ? "Large-file processing is ready." : "Run the processor on your laptop and enter its key."}</span></div>
          </div>

          {!connected && <div className="connect-form">
            <label htmlFor="processor-key">Local processor key</label>
            <input id="processor-key" type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="Paste key from processor terminal" autoComplete="off" />
            <button onClick={connect} disabled={connecting}>{connecting ? <LoaderCircle className="spin" /> : <Wifi size={16} />}{connecting ? "Connecting..." : "Connect Processor"}</button>
          </div>}
          {connected && <button className="disconnect" onClick={disconnect}>Disconnect processor</button>}

          <a
            className="processor-download"
            href="https://github.com/taffuwebx09/morning-aging-report-generator-/archive/refs/heads/main.zip"
            download
          >
            <Download size={16} />
            <span><b>Download Windows Processor</b><small>One-time setup · ZIP · Windows</small></span>
          </a>

          <div className={`drop ${dragging ? "drag" : ""}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); chooseFile(e.dataTransfer.files?.[0]); }}>
            <input ref={picker} type="file" hidden accept=".csv,text/csv" onChange={e => chooseFile(e.target.files?.[0])} />
            <div className="upload-icon"><UploadCloud size={29} /></div>
            <h2>{file ? file.name : "Upload Projection CSV"}</h2>
            <p>{file ? `${prettySize(file.size)} · Ready to process` : "Drag & drop your CSV file here, or choose from your computer."}</p>
            <button className="choose" onClick={() => picker.current?.click()} disabled={status === "uploading" || status === "processing"}><FileSpreadsheet size={16} />Choose CSV File</button>
            <small><LockKeyhole size={12} /> CSV is sent only to your own laptop. No remote file upload.</small>
          </div>

          {file && <div className="file-row"><div><FileSpreadsheet size={17} /><span><b>{file.name}</b><small>{prettySize(file.size)}</small></span></div><button onClick={() => { setFile(null); setJob(null); setStatus("idle"); setError(""); }}>Change</button></div>}

          {file && status !== "uploading" && status !== "processing" && status !== "done" && <button className="process" onClick={startProcessing} disabled={!connected}><Zap size={17} />Process CSV & Generate Excel</button>}

          {(status === "uploading" || status === "processing") && <div className="progress-card">
            <div><b>{status === "uploading" ? "Uploading CSV to laptop" : stage || "Processing CSV"}</b><strong>{status === "uploading" ? `${uploadProgress}%` : `${progress}%`}</strong></div>
            <div className="track"><i style={{ width: `${status === "uploading" ? uploadProgress : progress}%` }} /></div>
            <small>{status === "uploading" ? "Keep this tab open while uploading." : "CSV stream parsing and Excel writing are running on your laptop."}</small>
          </div>}

          {status === "done" && job && <div className="result-card">
            <div className="success"><CheckCircle2 /><div><b>Workbook generated successfully</b><small>{(job.rowsProcessed || 0).toLocaleString("en-IN")} records · {prettySize(job.outputSize || 0)}</small></div></div>
            <div className="buckets">{["OPS", "CS", "Security"].map(name => <div key={name}><span>{name}</span><b>{(job.bucketTotals?.[name] || 0).toLocaleString("en-IN")}</b></div>)}</div>
            <div className="result-meta"><span>Exported rows: {(job.exportedRows || 0).toLocaleString("en-IN")}</span><span>Processed Data sheets: {job.dataSheets || 1}</span></div>
            {(job.warnings || []).length > 0 && <div className="warnings"><AlertTriangle size={17} /><div><b>Review warnings</b><ul>{job.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div></div>}
            <div className="preview">
              <div className="preview-title"><b>Morning Aging Report Preview</b><span>First 18 rows</span></div>
              <div className="table-scroll"><table><thead><tr><th>remark</th><th>sr</th>{AGING.map(a => <th key={a}>{a}</th>)}<th>Grand Total</th></tr></thead><tbody>
                {preview.map((r, i) => <tr key={i} className={r.isSubtotal || r.isGrand ? "subtotal" : ""}><td>{r.remark}</td><td>{r.sr}</td>{AGING.map(a => <td key={a}>{r.counts?.[a] ? Number(r.counts[a]).toLocaleString("en-IN") : ""}</td>)}<td>{Number(r.total || 0).toLocaleString("en-IN")}</td></tr>)}
              </tbody></table></div>
            </div>
            <button className="download" onClick={downloadWorkbook}><Download size={18} />Download Complete Excel (Report + Data)</button>
            <small className="download-note">One workbook · Morning Aging Report first · Processed Data next.</small>
          </div>}

          {error && <div className="error"><AlertTriangle size={17} /><span>{error}</span></div>}
        </div>

        <aside className="side">
          <div className="feature amber"><Zap size={27} /></div>
          <h3>Auto Processing</h3>
          <p>Waybill cleanup, selected remark updates and aging summary.</p>
        </aside>
      </section>

      <section className="features">
        <article><div><Brush /></div><b>Waybill Cleanup</b><span>Comma, backtick and apostrophe removed.</span></article>
        <article><div><Repeat2 /></div><b>Remark Mapping</b><span>Only your agreed SR-to-remark rules.</span></article>
        <article><div><BarChart3 /></div><b>Aging Summary</b><span>OPS, CS, Security and Grand Total.</span></article>
        <article><div><ShieldCheck /></div><b>Data Validation</b><span>Blank and unknown aging bucket warnings.</span></article>
      </section>

      <section className="help-section" id="help">
        <h3><ShieldCheck size={17} />Before processing</h3>
        <p>1. Run <code>npm run processor</code> in a terminal on this laptop.</p>
        <p>2. Copy the local processor key printed in the terminal and connect above.</p>
        <p>3. Keep the processor terminal open until the workbook download finishes.</p>
      </section>
      <footer><span>Morning Aging Report Generator</span><span>Automated · Accurate · Local processing · v2.1</span></footer>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
