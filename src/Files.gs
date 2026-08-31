/**
 * Files.gs — Drive storage.
 *
 * Nothing here is ever shared. The web app runs as the owner and serves images
 * back to the browser itself, so the principal can review evidence from outside
 * the organisation while every file stays closed in the owner's Drive.
 *
 * Names are rebuilt on upload because "IMG_20260830_142233.jpg" tells an auditor
 * nothing once the file has been downloaded and separated from its folder.
 */

function rootFolder_() {
  const id = setting_(SETTING_KEY.ROOT_FOLDER, '');
  if (id) return DriveApp.getFolderById(id);
  const folder = childFolder_(DriveApp.getRootFolder(), FOLDER.ROOT);
  setSetting_(SETTING_KEY.ROOT_FOLDER, folder.getId());
  return folder;
}

function childFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/**
 * Folder for a claim. Drafts live under _DRAFT because their reference number
 * is not assigned until they are submitted.
 *
 * The claim records the folder it was given, and opening it by id is one Drive
 * call where walking the tree from the root is four. That matters: every file
 * uploaded against a claim used to walk the whole chain again, so a claim with
 * four attachments paid for it four times over.
 */
function claimFolder_(claim) {
  if (claim.DriveFolderId) {
    try {
      return DriveApp.getFolderById(claim.DriveFolderId);
    } catch (e) {
      // Removed or moved by hand: fall through and find it the long way.
    }
  }
  const root = rootFolder_();
  const base = isTrue_(claim.IsTest) ? childFolder_(root, FOLDER.TEST) : root;
  const parent = claim.RefNo
    ? childFolder_(base, claim.RefNo)
    : childFolder_(base, FOLDER.DRAFT);
  return childFolder_(parent, claim.ClaimID);
}

function kindFolder_(claim, kind) {
  return childFolder_(claimFolder_(claim), KIND_FOLDER[kind]);
}

/** Upper-cased, punctuation collapsed to hyphens — safe in a file name and readable. */
function slug_(text) {
  return String(text || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function extensionOf_(fileName, mimeType) {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(String(fileName || ''));
  if (m) return m[1].toLowerCase();
  if (String(mimeType).indexOf('pdf') !== -1) return 'pdf';
  if (String(mimeType).indexOf('png') !== -1) return 'png';
  return 'jpg';
}

/**
 * {RefNo}_{ClaimID}_{SN}_{KIND}[-{nn}][_{PART-NAME}].{ext}
 * FAULT and REPORT carry no part name — they belong to the whole claim.
 */
function attachmentName_(claim, kind, opts) {
  const o = opts || {};
  const parts = [claim.RefNo || 'DRAFT', claim.ClaimID, String(claim.SerialNumber || '').toUpperCase()];
  let tail = kind;
  if (kind === ATTACHMENT_KIND.PART) {
    tail += '-' + padLeft_(o.index || 1, 2);
    if (o.partName) tail += '_' + slug_(o.partName);
  }
  parts.push(tail);
  return parts.join('_') + '.' + o.extension;
}

/**
 * Stores one uploaded file. Re-uploads never overwrite: the earlier version may
 * already have been what the principal saw when they decided.
 */
function saveAttachment_(session, claim, spec) {
  const ext = extensionOf_(spec.fileName, spec.mimeType);
  const baseName = attachmentName_(claim, spec.kind, {
    index: spec.index, partName: spec.partName, extension: ext
  });

  const previous = readAll_(SHEET.ATTACHMENTS).filter(function (a) {
    return a.ClaimID === claim.ClaimID && a.Kind === spec.kind &&
      (spec.kind !== ATTACHMENT_KIND.PART || a.ItemID === spec.itemId) &&
      !isTrue_(a.Superseded);
  });

  const version = previous.length + 1;
  const fileName = version === 1
    ? baseName
    : baseName.replace(/\.([^.]+)$/, '_v' + version + '.$1');

  previous.forEach(function (a) {
    update_(SHEET.ATTACHMENTS, 'AttachmentID', a.AttachmentID, { Superseded: true });
  });

  const blob = Utilities.newBlob(
    Utilities.base64Decode(spec.data), spec.mimeType || 'application/octet-stream', fileName
  );
  const file = kindFolder_(claim, spec.kind).createFile(blob);

  const record = {
    AttachmentID: nextId_(SHEET.ATTACHMENTS, 'AttachmentID', 'ATT'),
    ClaimID: claim.ClaimID,
    ItemID: spec.itemId || '',
    Kind: spec.kind,
    DriveFileId: file.getId(),
    FileName: fileName,
    OriginalFileName: spec.fileName || '',
    MimeType: spec.mimeType || '',
    SizeBytes: file.getSize(),
    Version: version,
    Superseded: false,
    UploadedBy: session.email,
    UploadedAt: nowIso_()
  };
  insert_(SHEET.ATTACHMENTS, record);
  return record;
}

/**
 * Moves a submitted claim out of _DRAFT into its daily batch folder and renames
 * every file to carry the final reference number.
 */
function fileClaimOnSubmit_(claim) {
  const root = rootFolder_();
  const base = isTrue_(claim.IsTest) ? childFolder_(root, FOLDER.TEST) : root;
  const target = childFolder_(base, claim.RefNo);

  const folder = claimFolder_(claim);
  const parents = folder.getParents();
  while (parents.hasNext()) {
    const parent = parents.next();
    if (parent.getId() !== target.getId()) parent.removeFolder(folder);
  }
  target.addFolder(folder);

  const attachments = readAll_(SHEET.ATTACHMENTS).filter(function (a) {
    return a.ClaimID === claim.ClaimID && !isTrue_(a.Superseded);
  });
  const items = readLive_(SHEET.ITEMS).filter(function (i) { return i.ClaimID === claim.ClaimID; });

  attachments.forEach(function (a) {
    const item = items.filter(function (i) { return i.ItemID === a.ItemID; })[0];
    const index = item ? items.indexOf(item) + 1 : 1;
    const name = attachmentName_(claim, a.Kind, {
      index: index,
      partName: item ? item.PartName : '',
      extension: extensionOf_(a.FileName, a.MimeType)
    });
    if (name !== a.FileName) {
      try {
        DriveApp.getFileById(a.DriveFileId).setName(name);
        update_(SHEET.ATTACHMENTS, 'AttachmentID', a.AttachmentID, { FileName: name });
      } catch (e) {
        // A file removed by hand should not block the submission.
      }
    }
  });

  return folder.getId();
}

/** Returns an attachment as a data URI so the page can show it without sharing. */
function attachmentData_(session, attachmentId) {
  const record = findBy_(SHEET.ATTACHMENTS, 'AttachmentID', attachmentId);
  if (!record) throw new Error('Attachment not found.');

  const claim = findBy_(SHEET.CLAIMS, 'ClaimID', record.ClaimID);
  if (!claim) throw new Error('Claim not found.');
  if (!visibleClaims_(session).some(function (c) { return c.ClaimID === claim.ClaimID; })) {
    throw forbid_();
  }

  const file = DriveApp.getFileById(record.DriveFileId);
  const mime = file.getMimeType();

  // PDFs are offered as a link rather than inlined; a service report can be
  // several megabytes and would stall the page.
  if (String(mime).indexOf('pdf') !== -1) {
    return { kind: 'pdf', name: record.FileName, url: file.getUrl(), mimeType: mime };
  }
  return {
    kind: 'image',
    name: record.FileName,
    mimeType: mime,
    dataUri: 'data:' + mime + ';base64,' + Utilities.base64Encode(file.getBlob().getBytes())
  };
}

function attachmentsFor_(claimId) {
  return readAll_(SHEET.ATTACHMENTS)
    .filter(function (a) { return a.ClaimID === claimId && !isTrue_(a.Superseded); })
    .map(function (a) {
      return {
        attachmentId: a.AttachmentID, itemId: a.ItemID, kind: a.Kind,
        fileName: a.FileName, originalFileName: a.OriginalFileName,
        sizeBytes: a.SizeBytes, version: a.Version, uploadedAt: a.UploadedAt
      };
    });
}

/** Permanently removes a test claim's folder. The only hard delete in the system. */
function purgeTestFolders_() {
  const root = rootFolder_();
  const it = root.getFoldersByName(FOLDER.TEST);
  if (!it.hasNext()) return 0;
  const testRoot = it.next();
  let removed = 0;
  const batches = testRoot.getFolders();
  while (batches.hasNext()) {
    batches.next().setTrashed(true);
    removed++;
  }
  return removed;
}
