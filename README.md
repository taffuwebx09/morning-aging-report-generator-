# Morning Aging Report Generator v2.2.1 — Portable Windows Processor

## What this release provides
- Vercel-hosted React/Vite website.
- A local Windows processor that streams CSV parsing and Excel generation on the user's PC.
- A one-time Windows setup (`desktop-installer/Setup.bat`) that downloads a portable Node.js LTS runtime and installs processor dependencies.
- No VS Code and no globally installed Node.js required on end-user PCs.
- CMD / PowerShell are Windows built-ins; the installer invokes PowerShell automatically.
- After one-time setup, daily use is a Desktop shortcut.

## One-time setup on each Windows PC
1. Download and extract the complete project ZIP.
2. Double-click `INSTALL_WINDOWS.bat` in the project root (or run `desktop-installer\\Setup.bat`).
4. Allow the setup to download the current Node.js 26 LTS Windows x64 ZIP from the official nodejs.org distribution and verify its SHA-256 checksum.
5. Setup installs the portable runtime under `%LOCALAPPDATA%\MorningAging\runtime`, installs processor packages under `%LOCALAPPDATA%\MorningAging\processor`, and creates a Desktop shortcut.

Internet is needed during first setup to download Node.js and npm dependencies. Node.js is not installed globally and does not need to be installed by the user.

## Daily use
1. Double-click the Desktop shortcut `Start Morning Aging Processor`.
2. A CMD window opens and prints the local processor key. Keep this window open.
3. Open your Vercel website.
4. Paste the key once and click Connect Processor. Browser Local Network / Loopback permission may appear; allow it for your site.
5. Upload CSV, process, and download the one Excel workbook.
6. Close the CMD window only after download finishes.

The key is saved in the user's profile in `.morning-aging-report-processor/token` and remains stable for this PC. Do not share the key.

## Local website development
The root project is the Vercel frontend:
```powershell
npm install
npm run dev
```
Build:
```powershell
npm run build
```
Vercel settings:
- Framework: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Root directory: `./`

The desktop installer is separate and is not required for Vercel build.

## CSV / report behaviour
Required CSV headers: `waybill_number`, `sr`, `center_aging_bucket`. `remark` is recommended; if missing it is added.
- Removes comma, backtick and apostrophe from waybill numbers without numeric conversion.
- Added to Bag / Re-attempt at RCN => OPS
- On hold. Finance embargo / On Hold. Recipient unable to Accept Delivery / Seller/CWH permanently closed / Brand box => CS
- Package Missing in Audit / Short Bag / Short Shipment / Under security investigation / Barcode/QR mismatch => Security
- Other existing remarks and SR values are preserved; Ops/OPS/CS/Security group labels are normalized.
- One XLSX workbook: Morning Aging Report first, Processed Data second; additional Processed Data sheets are created if the Excel worksheet row limit is reached.
- Counts are row counts of non-empty waybills with recognized aging buckets, not distinct AWB counts.

## Performance / limitations
CSV parsing is streaming on the local Node processor. Cleaned source rows are written to disk, aggregation stores grouped counters, and ExcelJS Streaming WorkbookWriter commits data rows to disk-backed XLSX output. This substantially reduces browser RAM use and avoids a giant browser Blob. Performance still depends on CPU, RAM, disk space, CSV width/size and browser download behaviour. Benchmark your largest operational file.

## Security / privacy
- Processor binds only to `127.0.0.1`.
- API endpoints require a random local key.
- Uploaded CSV and intermediate files are written to the same PC's temporary folder; source/intermediate files are removed after processing. Completed workbooks expire after approximately 30 minutes.
- Vercel hosts the frontend only; the CSV file is sent to the user's own PC via localhost, not to Vercel.
- Browser permission may be required for an HTTPS site to access the local processor.


## Chrome / Edge Local Network permission
When connecting from the Vercel HTTPS site to the local processor, click the Connect Processor button first. Chrome or Edge may ask for Local Network / Loopback access; allow it for the site. The UI sends local API fetch requests with the `loopback` target address-space hint. The processor binds only to `127.0.0.1`.


## Processed Data sheet fix (v2.2.1)
The processor now writes the cleaned CSV's column header row before writing source records. The XLSX second-pass parser therefore reads the actual header row and emits every processed source record with its values. Before committing the workbook, it checks that the number of Processed Data rows written exactly matches the number of CSV data rows parsed. A mismatch fails the job instead of producing a misleading empty Processed Data worksheet.
