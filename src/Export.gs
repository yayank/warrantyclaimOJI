/**
 * Export.gs — Excel export.
 *
 * Apps Script cannot start a download from inside its own iframe, so the file is
 * written to Drive and the page opens the link in a new tab. Exports accumulate
 * there, which is why the daily cleanup trigger removes anything older than a
 * week.
 *
 * The export honours the caller's role on the server. Trusting the filter the
 * browser sent would let a principal export rows they cannot see on screen.
 */

function exportClaims_(session, filter) {
  const result = listClaims_(session, filter || {});
  const flat = (filter && filter.view === 'item');

  const header = flat
    ? ['Claim ID', 'Reference', 'Date', 'Customer', 'Serial number', 'Product',
      'Warranty', 'Warranty basis', 'Work order', 'Problem', 'Spare part', 'Qty',
      'Item status', 'Reason', 'Availability date', 'Document ref', 'Shipped at',
      'Part return', 'Requested by', 'Status', 'Attachments']
    : ['Claim ID', 'Reference', 'Date', 'Customer', 'Serial number', 'Product',
      'Warranty', 'Warranty basis', 'Work order', 'Problem', 'Parts', 'Approved',
      'Rejected', 'Pending', 'Requested by', 'Status', 'Attachments'];

  const folderLink = claimFolderLink_();
  const rows = [header];

  result.rows.forEach(function (c) {
    const link = folderLink(c);
    if (flat) {
      c.items.forEach(function (i) {
        rows.push([
          c.claimId, c.refNo, c.submittedAt || c.createdAt, c.customerName, c.serialNumber,
          c.productName, c.warrantyType, c.warrantyBasis, c.workOrderNo, c.problem,
          i.partName, i.qty, i.itemStatus, i.decisionReason, i.availabilityDate,
          i.documentRefNo, i.shippedAt, i.partReturnNote, c.requesterName, c.status, link
        ]);
      });
    } else {
      rows.push([
        c.claimId, c.refNo, c.submittedAt || c.createdAt, c.customerName, c.serialNumber,
        c.productName, c.warrantyType, c.warrantyBasis, c.workOrderNo, c.problem,
        c.items.map(function (i) { return i.partName + ' ×' + i.qty; }).join('; '),
        c.summary.approved, c.summary.rejected, c.summary.pending,
        c.requesterName, c.status, link
      ]);
    }
  });

  const name = exportFileName_(filter);
  const temp = SpreadsheetApp.create(name);
  try {
    const sheet = temp.getSheets()[0];
    sheet.setName('Claims');
    sheet.getRange(1, 1, rows.length, header.length).setValues(rows);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    SpreadsheetApp.flush();

    const url = 'https://docs.google.com/spreadsheets/d/' + temp.getId() + '/export?format=xlsx';
    const blob = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
    }).getBlob().setName(name + '.xlsx');

    const file = childFolder_(rootFolder_(), FOLDER.EXPORT).createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    return { fileName: file.getName(), url: file.getUrl(), rows: rows.length - 1 };
  } finally {
    DriveApp.getFileById(temp.getId()).setTrashed(true);
  }
}

/** Links each row back to its evidence folder so an auditor can jump from Excel. */
function claimFolderLink_() {
  const folders = {};
  readAll_(SHEET.CLAIMS).forEach(function (c) {
    if (c.DriveFolderId) folders[c.ClaimID] = 'https://drive.google.com/drive/folders/' + c.DriveFolderId;
  });
  return function (claim) { return folders[claim.claimId] || ''; };
}

function exportFileName_(filter) {
  const f = filter || {};
  const parts = ['Klaim'];
  if (f.search) parts.push(slug_(f.search));
  if (f.from || f.to) parts.push((f.from || 'awal') + '_sd_' + (f.to || 'kini'));
  if (f.statuses && f.statuses.length === 1) parts.push(slug_(f.statuses[0]));
  if (parts.length === 1) parts.push(Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'));
  return parts.join('_');
}

/** Removes export files past their retention window. */
function cleanUpExports_() {
  const folder = childFolder_(rootFolder_(), FOLDER.EXPORT);
  const cutoff = Date.now() - EXPORT_RETENTION_DAYS * 86400000;
  const files = folder.getFiles();
  let removed = 0;
  while (files.hasNext()) {
    const file = files.next();
    if (file.getDateCreated().getTime() < cutoff) {
      file.setTrashed(true);
      removed++;
    }
  }
  return removed;
}
