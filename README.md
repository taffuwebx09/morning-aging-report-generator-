# Morning Aging Report Generator v1.2

## Run locally
1. Install Node.js 18+.
2. Extract this ZIP and open the project folder in VS Code.
3. Run `npm install`
4. Run `npm run dev` and open the Vite URL.

## CSV input
Upload the daily projection as CSV. Required columns (case-insensitive):
- `waybill_number`
- `sr`
- `center_aging_bucket`

If `remark` exists, it is updated only for the specified SR rules. If it does not exist, a new `remark` column is added.

## Download format
One `.xlsx` workbook is downloaded with two worksheets:
1. `Morning Aging Report` — formatted subtotal report with OPS, CS, Security and Grand Total.
2. `Processed Data` — all original projection columns, cleaned waybill numbers, and updated remark values.

The report sheet follows the user's supplied sample: bucket columns in order `0 days` through `5 days`, then `>5 days`, then `Grand Total`. Detail SR rows have blank remark cells.

## Remark rules
- Added to Bag / Re-attempt at RCN => OPS.
- Finance embargo / Recipient unable / Seller-CWH permanently closed / Brand box => CS.
- Package Missing in Audit / Short Bag / Short Shipment / Under security investigation / Barcode/QR mismatch => Security.
- Existing other remark values and SR labels are preserved.

## Waybill cleanup
Removes comma, backtick and apostrophe characters from `waybill_number`, retaining the value as text.

## Scale notes
CSV parsing is incremental in a Web Worker. The combined XLSX export builds a worksheet in batches, but XLSX workbook generation still uses browser memory. The Excel worksheet limit is 1,048,576 rows including the header; very wide or very large files can exceed browser memory before that limit. Test the largest daily file on the actual target laptop.
