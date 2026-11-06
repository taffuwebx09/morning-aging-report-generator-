import express from "express";
import multer from "multer";
import { parse } from "csv-parse";
import ExcelJS from "exceljs";
import { createReadStream, createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { once } from "node:events";
import { finished } from "node:stream/promises";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PROCESSOR_PORT || 47831);
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 5 * 1024 ** 3);
const MAX_DATA_ROWS = 1_048_575;
const RETENTION_MS = 30 * 60 * 1000;
const ROOT = path.join(os.tmpdir(), "morning-aging-report-processor");
const UPLOADS = path.join(ROOT, "uploads");
const CREDENTIAL_DIR = path.join(os.homedir(), ".morning-aging-report-processor");
const TOKEN_FILE = path.join(CREDENTIAL_DIR, "token");

const AGING = ["0 days", "1 days", "2 days", "3 days", "4 days", "5 days", ">5 days"];
const PRIMARY = ["OPS", "CS", "Security"];
const OPS_SR = new Set(["added to bag", "re-attempt at rcn"]);
const CS_SR = new Set([
  "on hold. finance embargo",
  "on hold. recipient unable to accept delivery",
  "seller/cwh permanently closed",
  "brand box"
]);
const SECURITY_SR = new Set([
  "package missing in audit",
  "short bag",
  "short shipment",
  "under security investigation",
  "barcode/qr mismatch"
]);

const jobs = new Map();
const tickets = new Map();
const cleanupTimers = new Map();
let processorToken = "";

const app = express();
app.disable("x-powered-by");

function cors(req, res, next) {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Processor-Token");
  res.setHeader("Access-Control-Max-Age", "600");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
}
app.use(cors);

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function auth(req, res, next) {
  if (!safeEqual(req.get("X-Processor-Token") || "", processorToken)) {
    return res.status(401).json({ error: "Local processor key incorrect hai. Terminal se key dobara copy karo." });
  }
  next();
}
function norm(v) { return String(v ?? "").trim().replace(/\s+/g, " "); }
function key(v) { return norm(v).toLowerCase(); }
function cleanWaybill(v) { return String(v ?? "").replace(/[`,']/g, "").trim(); }
function keepOrNormalizeRemark(v) {
  const raw = String(v ?? "");
  const x = norm(raw);
  if (/^ops$/i.test(x)) return "OPS";
  if (/^cs$/i.test(x)) return "CS";
  if (/^security$/i.test(x)) return "Security";
  return raw;
}
function classify(sr, oldRemark) {
  const s = key(sr);
  if (OPS_SR.has(s)) return "OPS";
  if (CS_SR.has(s)) return "CS";
  if (SECURITY_SR.has(s)) return "Security";
  return keepOrNormalizeRemark(oldRemark);
}
function agingBucket(v) {
  const x = key(v);
  const map = {
    "0":"0 days","0 day":"0 days","0 days":"0 days",
    "1":"1 days","1 day":"1 days","1 days":"1 days",
    "2":"2 days","2 day":"2 days","2 days":"2 days",
    "3":"3 days","3 day":"3 days","3 days":"3 days",
    "4":"4 days","4 day":"4 days","4 days":"4 days",
    "5":"5 days","5 day":"5 days","5 days":"5 days",
    ">5 days":">5 days","> 5 days":">5 days","more than 5 days":">5 days"
  };
  return map[x] || null;
}
function csvCell(v) {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
async function writeBackpressure(stream, chunk) {
  if (stream.write(chunk)) return;
  await once(stream, "drain");
}
function safeFileBase(name) {
  return path.basename(name || "projection.csv").replace(/\.csv$/i, "")
    .replace(/[^a-zA-Z0-9._ -]/g, "_").trim().slice(0, 90) || "projection";
}
function update(job, patch) { Object.assign(job, patch, { updatedAt: Date.now() }); }

async function parseCsvAndAggregate(job, inputPath, cleanedPath) {
  let headers;
  let waybillHeader, srHeader, agingHeader, remarkHeader;
  let rows = 0, counted = 0, blankWaybills = 0, unmappedAging = 0;
  const groups = new Map();
  const bucketTotals = { OPS: 0, CS: 0, Security: 0 };
  const output = createWriteStream(cleanedPath, { encoding: "utf8" });
  const input = createReadStream(inputPath);
  const parser = parse({
    bom: true,
    columns(rawHeaders) {
      const normalized = rawHeaders.map((v, i) => {
        const h = String(v ?? "").trim();
        return h || `column_${i + 1}`;
      });
      const seen = new Set();
      for (const h of normalized) {
        const k = key(h);
        if (seen.has(k)) throw new Error(`Duplicate CSV header "${h}". Please correct the CSV header row.`);
        seen.add(k);
      }
      headers = [...normalized];
      const map = new Map(headers.map(h => [key(h), h]));
      const missing = ["waybill_number", "sr", "center_aging_bucket"].filter(h => !map.has(h));
      if (missing.length) {
        const e = new Error(`Missing required CSV column(s): ${missing.join(", ")}.`);
        e.code = "MISSING_COLUMNS";
        throw e;
      }
      waybillHeader = map.get("waybill_number");
      srHeader = map.get("sr");
      agingHeader = map.get("center_aging_bucket");
      remarkHeader = map.get("remark");
      if (!remarkHeader) {
        remarkHeader = "remark";
        headers.push("remark");
      }
      return normalized;
    },
    skip_empty_lines: true,
    relax_column_count: true,
    trim: false
  });

  let sourceBytes = 0;
  const totalBytes = Math.max(1, (await fs.stat(inputPath)).size);
  let lastProgress = 0;
  input.on("data", chunk => {
    sourceBytes += chunk.length;
    if (Date.now() - lastProgress > 250) {
      const fraction = Math.min(1, sourceBytes / totalBytes);
      update(job, { progress: Math.min(62, 4 + Math.floor(fraction * 58)), stage: "Streaming CSV · Cleaning waybills · Calculating aging totals" });
      lastProgress = Date.now();
    }
  });
  input.on("error", e => parser.destroy(e));
  input.pipe(parser);

  try {
    for await (const record of parser) {
      rows += 1;
      record[waybillHeader] = cleanWaybill(record[waybillHeader]);
      const waybill = record[waybillHeader];
      const sr = norm(record[srHeader]);
      const remark = classify(sr, record[remarkHeader]);
      record[remarkHeader] = remark;

      if (!waybill) {
        blankWaybills += 1;
      } else {
        counted += 1;
        const bucket = agingBucket(record[agingHeader]);
        if (!bucket) {
          unmappedAging += 1;
        } else {
          if (Object.hasOwn(bucketTotals, remark)) bucketTotals[remark] += 1;
          let bySr = groups.get(remark);
          if (!bySr) { bySr = new Map(); groups.set(remark, bySr); }
          let item = bySr.get(sr);
          if (!item) {
            item = { remark: "", sr, counts: Object.fromEntries(AGING.map(a => [a, 0])), total: 0 };
            bySr.set(sr, item);
          }
          item.counts[bucket] += 1;
          item.total += 1;
        }
      }

      const line = headers.map(h => csvCell(record[h])).join(",") + "\r\n";
      await writeBackpressure(output, line);
      if (rows % 10000 === 0) update(job, { rowsProcessed: rows });
    }
    output.end();
    await finished(output);
  } catch (e) {
    input.destroy();
    parser.destroy();
    output.destroy();
    throw e;
  }

  if (!headers) throw new Error("CSV empty hai ya header row nahi mili.");
  const reportRows = [];
  const grand = { remark: "Grand Total", sr: "", counts: Object.fromEntries(AGING.map(a => [a, 0])), total: 0, isGrand: true };
  const others = [...groups.keys()].filter(r => !PRIMARY.includes(r)).sort((a,b) => a.localeCompare(b));
  const remarks = [...PRIMARY, ...others];
  for (const remark of remarks) {
    const bySr = groups.get(remark) || new Map();
    const subtotal = { remark, sr: "", counts: Object.fromEntries(AGING.map(a => [a, 0])), total: 0, isSubtotal: true };
    const detailRows = [...bySr.values()].sort((a,b) => a.sr.localeCompare(b.sr, undefined, { numeric: true, sensitivity: "base" }));
    for (const item of detailRows) {
      reportRows.push({ ...item, remark: "" });
      for (const a of AGING) {
        subtotal.counts[a] += item.counts[a];
        grand.counts[a] += item.counts[a];
      }
      subtotal.total += item.total;
      grand.total += item.total;
    }
    reportRows.splice(reportRows.length - detailRows.length, 0, subtotal);
  }
  reportRows.push(grand);

  const warnings = [];
  if (unmappedAging) warnings.push(`${unmappedAging.toLocaleString("en-IN")} waybills have blank or unrecognized center_aging_bucket; excluded from aging totals.`);
  if (blankWaybills) warnings.push(`${blankWaybills.toLocaleString("en-IN")} rows have empty waybill_number and were not counted.`);
  if (others.length) warnings.push(`Other existing remark groups were preserved: ${others.slice(0, 10).join(", ")}${others.length > 10 ? "…" : ""}.`);
  return { headers, rows, counted, blankWaybills, unmappedAging, bucketTotals, reportRows, warnings };
}

function formatHeader(row) {
  row.height = 24;
  row.eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Aptos", size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF203B61" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = { bottom: { style: "thin", color: { argb: "FF9DB4D0" } } };
  });
}
function formatTotal(row, grand = false) {
  row.height = 21;
  row.eachCell({ includeEmpty: true }, cell => {
    cell.font = { bold: true, color: { argb: "FF172C49" }, name: "Aptos", size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: grand ? "FFBBD5F2" : "FFDCEAF8" } };
    cell.alignment = { vertical: "middle" };
    cell.border = { top: { style: "thin", color: { argb: "FF9BB4D2" } }, bottom: { style: "thin", color: { argb: "FF9BB4D2" } } };
  });
}

async function createWorkbook(job, cleanedPath, outputPath, summary) {
  update(job, { progress: 68, stage: "Streaming Excel workbook · Writing report sheet" });
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: outputPath,
    useStyles: true,
    useSharedStrings: false,
    zip: { zlib: { level: 1 } }
  });
  workbook.creator = "Morning Aging Report Generator";
  workbook.created = new Date();

  const report = workbook.addWorksheet("Morning Aging Report", { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });
  report.columns = [{ width: 16 }, { width: 48 }, ...AGING.map(() => ({ width: 12 })), { width: 15 }];
  const header = report.addRow(["remark", "sr", ...AGING, "Grand Total"]);
  formatHeader(header);
  header.commit();
  for (const item of summary.reportRows) {
    const row = report.addRow([item.remark, item.sr, ...AGING.map(a => item.counts[a] || null), item.total || null]);
    if (item.isSubtotal || item.isGrand) formatTotal(row, Boolean(item.isGrand));
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.alignment = { horizontal: col >= 3 ? "right" : "left", vertical: "middle" };
      if (col >= 3) cell.numFmt = "#,##0";
      if (!item.isSubtotal && !item.isGrand) cell.border = { bottom: { style: "hair", color: { argb: "FFD5DDE8" } } };
    });
    row.commit();
  }
  report.commit();

  let sheetNo = 1, countInSheet = 0, exportedRows = 0, dataSheet;
  const makeDataSheet = () => {
    const name = sheetNo === 1 ? "Processed Data" : `Processed Data ${sheetNo}`;
    dataSheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    dataSheet.columns = summary.headers.map(h => ({ width: Math.min(34, Math.max(13, String(h).length + 2)) }));
    const r = dataSheet.addRow(summary.headers);
    formatHeader(r);
    r.commit();
    countInSheet = 0;
  };
  makeDataSheet();

  const parser = createReadStream(cleanedPath).pipe(parse({ bom: true, columns: true, skip_empty_lines: true, relax_column_count: true }));
  for await (const record of parser) {
    if (countInSheet >= MAX_DATA_ROWS) {
      dataSheet.commit();
      sheetNo += 1;
      makeDataSheet();
    }
    const values = summary.headers.map(h => String(record[h] ?? ""));
    dataSheet.addRow(values).commit();
    countInSheet += 1;
    exportedRows += 1;
    if (exportedRows % 10000 === 0) {
      const fraction = summary.rows ? exportedRows / summary.rows : 1;
      update(job, { progress: Math.min(98, 70 + Math.floor(fraction * 28)), stage: `Writing Processed Data · ${exportedRows.toLocaleString("en-IN")} rows` });
    }
  }
  dataSheet.commit();
  await workbook.commit();
  update(job, { exportedRows, dataSheets: sheetNo });
}

async function cleanupJob(id, delay = RETENTION_MS) {
  const old = cleanupTimers.get(id);
  if (old) clearTimeout(old);
  const timer = setTimeout(async () => {
    const job = jobs.get(id);
    if (job) {
      await fs.rm(job.dir, { recursive: true, force: true }).catch(() => {});
      jobs.delete(id);
    }
    cleanupTimers.delete(id);
    for (const [ticket, item] of tickets) if (item.jobId === id || item.expiresAt < Date.now()) tickets.delete(ticket);
  }, delay);
  timer.unref?.();
  cleanupTimers.set(id, timer);
}

async function processJob(job) {
  const cleanPath = path.join(job.dir, "processed-source.csv");
  const outputPath = path.join(job.dir, "Morning_Aging_Report.xlsx");
  try {
    update(job, { status: "processing", progress: 2, stage: "Starting CSV stream" });
    const summary = await parseCsvAndAggregate(job, job.inputPath, cleanPath);
    update(job, {
      rowsProcessed: summary.rows,
      countedWaybills: summary.counted,
      unmappedAging: summary.unmappedAging,
      bucketTotals: summary.bucketTotals,
      warnings: summary.warnings,
      reportPreview: summary.reportRows.slice(0, 18)
    });
    await createWorkbook(job, cleanPath, outputPath, summary);
    const stat = await fs.stat(outputPath);
    update(job, {
      status: "completed", progress: 100, stage: "Excel workbook ready",
      outputPath, outputSize: stat.size,
      filename: `${job.fileBase}_Morning_Aging_Report.xlsx`
    });
    cleanupJob(job.id);
  } catch (e) {
    console.error(`[job ${job.id}]`, e);
    update(job, { status: "error", stage: "Processing failed", error: e.message || "Unknown processor error." });
    cleanupJob(job.id, 5 * 60 * 1000);
  } finally {
    await fs.rm(job.inputPath, { force: true }).catch(() => {});
    await fs.rm(cleanPath, { force: true }).catch(() => {});
  }
}

await fs.mkdir(UPLOADS, { recursive: true });
await fs.mkdir(CREDENTIAL_DIR, { recursive: true });
try {
  processorToken = (await fs.readFile(TOKEN_FILE, "utf8")).trim();
} catch {
  processorToken = crypto.randomBytes(32).toString("hex");
  await fs.writeFile(TOKEN_FILE, processorToken, { mode: 0o600 });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS),
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}-${path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, "_")}`)
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 }
});

app.get("/api/health", (_req, res) => res.json({ ok: true, version: "2.1.0" }));
app.get("/api/verify", auth, (_req, res) => res.json({ ok: true }));

app.post("/api/jobs", auth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "CSV file receive nahi hui." });
  if (!/\.csv$/i.test(req.file.originalname)) {
    await fs.rm(req.file.path, { force: true });
    return res.status(400).json({ error: "Only CSV projection files supported hain." });
  }
  const id = crypto.randomUUID();
  const dir = path.join(ROOT, id);
  try {
    await fs.mkdir(dir, { recursive: true });
    const inputPath = path.join(dir, "input.csv");
    await fs.rename(req.file.path, inputPath);
    const job = {
      id, dir, inputPath, originalName: req.file.originalname,
      fileBase: safeFileBase(req.file.originalname), status: "queued",
      progress: 0, stage: "Queued", rowsProcessed: 0,
      createdAt: Date.now(), updatedAt: Date.now()
    };
    jobs.set(id, job);
    res.status(202).json({ jobId: id });
    setImmediate(() => processJob(job));
  } catch (e) {
    await fs.rm(req.file.path, { force: true }).catch(() => {});
    return res.status(500).json({ error: `Temporary job folder create nahi hua: ${e.message}` });
  }
});

app.get("/api/jobs/:id", auth, (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j) return res.status(404).json({ error: "Job expire ho gaya ya exist nahi karta." });
  const { id, status, progress, stage, rowsProcessed, countedWaybills, unmappedAging, bucketTotals, warnings, reportPreview, outputSize, filename, exportedRows, dataSheets, error } = j;
  res.json({ id, status, progress, stage, rowsProcessed, countedWaybills, unmappedAging, bucketTotals, warnings, reportPreview, outputSize, filename, exportedRows, dataSheets, error });
});

app.post("/api/jobs/:id/ticket", auth, (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j || j.status !== "completed" || !j.outputPath) return res.status(409).json({ error: "Workbook abhi ready nahi hai." });
  const ticket = crypto.randomBytes(24).toString("hex");
  tickets.set(ticket, { jobId: j.id, expiresAt: Date.now() + 60_000 });
  res.json({ url: `http://${HOST}:${PORT}/api/jobs/${j.id}/download?ticket=${ticket}` });
});

app.get("/api/jobs/:id/download", async (req, res) => {
  const ticket = String(req.query.ticket || "");
  const entry = tickets.get(ticket);
  if (!entry || entry.jobId !== req.params.id || entry.expiresAt < Date.now()) return res.status(401).send("Download link expire ho gaya. Website se dobara Download click karo.");
  tickets.delete(ticket);
  const job = jobs.get(req.params.id);
  if (!job?.outputPath) return res.status(404).send("Workbook nahi mili. CSV dobara process karo.");
  try {
    const stat = await fs.stat(job.outputPath);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Content-Disposition", `attachment; filename="${job.filename}"`);
    const stream = createReadStream(job.outputPath);
    stream.on("error", e => {
      console.error("Download stream error:", e);
      if (!res.headersSent) res.status(500);
      res.end();
    });
    stream.pipe(res);
  } catch (e) {
    res.status(500).send(`Workbook read nahi hui: ${e.message}`);
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: `CSV upload configured limit ${(MAX_UPLOAD_BYTES / 1024 ** 3).toFixed(1)} GB se badi hai.` });
  }
  console.error(error);
  return res.status(500).json({ error: error.message || "Local processor error." });
});

app.listen(PORT, HOST, () => {
  console.log("\nMorning Aging Local Processor v2.1 is running.");
  console.log(`Local API: http://${HOST}:${PORT}`);
  console.log("Copy this local processor key into the Vercel website:");
  console.log(`\n${processorToken}\n`);
  console.log("Keep this terminal open until processing and download finish.");
  console.log("Press Ctrl+C to stop.\n");
});
