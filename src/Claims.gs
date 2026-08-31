/**
 * Claims.gs — claims, items and every transition between them.
 *
 * A claim holds one machine; its items hold the parts, and decisions are taken
 * per item. The claim's Status therefore reports position in the workflow only —
 * "2 approved · 1 rejected" is reported separately, so no row ever carries an
 * ambiguous combined verdict.
 */

/* ------------------------------------------------------------------ read */

function listClaims_(session, filter) {
  const f = filter || {};
  const claims = visibleClaims_(session);
  const items = readLive_(SHEET.ITEMS);
  const byClaim = {};
  items.forEach(function (i) {
    (byClaim[i.ClaimID] = byClaim[i.ClaimID] || []).push(i);
  });

  let rows = claims.map(function (c) { return shapeClaim_(c, byClaim[c.ClaimID] || []); });

  if (f.search) {
    const q = String(f.search).toLowerCase();
    rows = rows.filter(function (r) {
      return [r.claimId, r.refNo, r.serialNumber, r.customerName, r.workOrderNo]
        .join(' ').toLowerCase().indexOf(q) !== -1;
    });
  }
  if (f.statuses && f.statuses.length) {
    rows = rows.filter(function (r) { return f.statuses.indexOf(r.status) !== -1; });
  }
  if (f.warrantyTypes && f.warrantyTypes.length) {
    rows = rows.filter(function (r) { return f.warrantyTypes.indexOf(r.warrantyType) !== -1; });
  }
  if (f.customerId) rows = rows.filter(function (r) { return r.customerId === f.customerId; });
  if (f.principal) rows = rows.filter(function (r) { return r.principal === f.principal; });
  if (f.partId) {
    rows = rows.filter(function (r) {
      return r.items.some(function (i) { return i.partId === f.partId; });
    });
  }
  if (f.from) rows = rows.filter(function (r) { return (r.sortDate || '') >= f.from; });
  if (f.to) rows = rows.filter(function (r) { return (r.sortDate || '') <= f.to + 'T23:59:59'; });
  if (f.tab) rows = rows.filter(function (r) { return matchesTab_(session, r, f.tab); });

  rows.sort(function (a, b) { return String(b.sortDate).localeCompare(String(a.sortDate)); });

  return { rows: rows, counts: tabCounts_(session, claims, byClaim) };
}

function matchesTab_(session, row, tab) {
  if (tab === 'all') return true;
  if (tab === 'completed') return row.status === STATUS.CLOSED;
  if (tab === 'progress') {
    // A draft has not been submitted, so nothing about it is in progress: it is
    // the requester's own unfinished work, and an administrator seeing it in
    // their working tabs reads as work waiting on somebody. Drafts other than
    // your own are reachable from All.
    return [STATUS.CLOSED, STATUS.DRAFT].indexOf(row.status) === -1 &&
      !needsAction_(session, row);
  }
  if (tab === 'action') return needsAction_(session, row);
  return true;
}

/** What the signed-in role still has to do about this claim. */
function needsAction_(session, row) {
  switch (session.role) {
    case ROLE.REQUESTER:
    case ROLE.PRODUCTION:
      return row.status === STATUS.DRAFT || row.status === STATUS.RETURNED;

    case ROLE.ADMIN:
      if (row.status === STATUS.SUBMITTED) return true;
      if (row.status === STATUS.INTERNAL) return true;
      if (row.status === STATUS.FULFILMENT) {
        return row.items.some(function (i) {
          return [ITEM_STATUS.APPROVED, ITEM_STATUS.FORWARDED, ITEM_STATUS.AWAITING]
            .indexOf(i.itemStatus) !== -1;
        });
      }
      return false;

    case ROLE.PRINCIPAL:
      return row.status === STATUS.IN_REVIEW &&
        row.items.some(function (i) { return i.itemStatus === ITEM_STATUS.PENDING; });

    default:
      return false;
  }
}

function tabCounts_(session, claims, byClaim) {
  let action = 0;
  claims.forEach(function (c) {
    if (needsAction_(session, shapeClaim_(c, byClaim[c.ClaimID] || []))) action++;
  });
  return { action: action };
}

function shapeClaim_(c, items) {
  const shaped = items.map(shapeItem_);
  const approved = shaped.filter(function (i) {
    return [ITEM_STATUS.APPROVED, ITEM_STATUS.FORWARDED, ITEM_STATUS.AWAITING,
      ITEM_STATUS.SHIPPED].indexOf(i.itemStatus) !== -1;
  }).length;
  const rejected = shaped.filter(function (i) { return i.itemStatus === ITEM_STATUS.REJECTED; }).length;
  const pending = shaped.filter(function (i) { return i.itemStatus === ITEM_STATUS.PENDING; }).length;
  const shipped = shaped.filter(function (i) { return i.itemStatus === ITEM_STATUS.SHIPPED; }).length;
  const advance = shaped.filter(function (i) { return i.advanceIssued; }).length;
  const awaitingReturn = shaped.filter(function (i) { return i.awaitingReturn; }).length;

  const stamp = c.SubmittedAt || c.CreatedAt || '';
  return {
    claimId: c.ClaimID,
    refNo: c.RefNo,
    isTest: isTrue_(c.IsTest),
    customerId: c.CustomerID,
    customerName: c.CustomerName,
    serialNumber: c.SerialNumber,
    productName: c.ProductName,
    assemblyMonth: c.AssemblyMonth,
    principal: String(c.Principal || ''),
    warrantyType: c.WarrantyType,
    warrantyExpiry: c.WarrantyExpiry,
    warrantyBasis: c.WarrantyBasis,
    warrantyOverridden: isTrue_(c.WarrantyOverridden),
    warrantyOverrideReason: c.WarrantyOverrideReason,
    problem: c.ProblemDescription,
    workOrderNo: c.WorkOrderNo,
    status: c.Status,
    requesterEmail: c.RequesterEmail,
    requesterName: c.RequesterName,
    createdAt: c.CreatedAt,
    submittedAt: c.SubmittedAt,
    forwardedAt: c.ForwardedAt,
    closedAt: c.ClosedAt,
    returnReason: c.ReturnReason,
    rowVersion: Number(c.RowVersion || 0),
    updatedAt: c.UpdatedAt,
    sortDate: String(stamp),
    ageDays: ageDays_(c),
    summary: {
      approved: approved, rejected: rejected, pending: pending,
      shipped: shipped, advance: advance, awaitingReturn: awaitingReturn
    },
    items: shaped
  };
}

function shapeItem_(i) {
  return {
    itemId: i.ItemID,
    claimId: i.ClaimID,
    partId: i.PartID,
    partName: i.PartName,
    qty: Number(i.Qty || 0),
    itemStatus: i.ItemStatus,
    advanceIssued: isTrue_(i.AdvanceIssued),
    advanceIssuedAt: i.AdvanceIssuedAt,
    advanceIssuedBy: i.AdvanceIssuedBy,
    advanceNote: i.AdvanceNote,
    decisionBy: i.DecisionBy,
    decisionAt: i.DecisionAt,
    decisionReason: i.DecisionReason,
    availabilityDate: i.AvailabilityDate ? formatDate_(i.AvailabilityDate) : '',
    documentRefNo: i.DocumentRefNo,
    fulfilmentRoute: i.FulfilmentRoute || '',
    forwardedAt: i.ForwardedAt,
    forwardedTo: i.ForwardedTo,
    shippedAt: i.ShippedAt,
    partReturnNote: i.PartReturnNote,
    partReturnAt: i.PartReturnAt,
    awaitingReturn: i.ItemStatus === ITEM_STATUS.SHIPPED && !String(i.PartReturnAt || '').trim(),
    rowVersion: Number(i.RowVersion || 0)
  };
}

function formatDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  // A date cell reaches here as the ISO timestamp cellValue_ made of it.
  const iso = /^(\d{4}-\d{2}-\d{2})T/.exec(String(v));
  return iso ? iso[1] : String(v);
}

/** Days spent in the current status — the column that stops claims being forgotten. */
function ageDays_(c) {
  if (c.Status === STATUS.CLOSED || c.Status === STATUS.DRAFT) return null;
  const from = c.UpdatedAt || c.SubmittedAt || c.CreatedAt;
  if (!from) return null;
  const then = new Date(String(from).replace(' ', 'T'));
  if (isNaN(then.getTime())) return null;
  return Math.floor((Date.now() - then.getTime()) / 86400000);
}

function getClaim_(session, claimId) {
  const claim = findBy_(SHEET.CLAIMS, 'ClaimID', claimId);
  if (!claim) throw new Error('Claim not found.');
  if (!visibleClaims_(session).some(function (c) { return c.ClaimID === claimId; })) throw forbid_();

  const items = readLive_(SHEET.ITEMS).filter(function (i) { return i.ClaimID === claimId; });
  const shaped = shapeClaim_(claim, items);
  shaped.attachments = attachmentsFor_(claimId);
  shaped.audit = auditForClaim_(claimId);
  shaped.canEdit = canEditClaimFields_(session, claim);
  return shaped;
}

/* ----------------------------------------------------------------- write */

/**
 * Creates or updates a claim. Requesters use this while the claim is a draft or
 * has been returned to them; administrators use the same path to correct a
 * submitted claim, which is recorded and notified rather than done silently.
 */
function saveClaim_(session, payload) {
  requireRole_(session, [ROLE.REQUESTER, ROLE.PRODUCTION, ROLE.ADMIN]);

  return withLock_(function () {
    const isNew = !payload.claimId;
    const isTest = session.isTester;

    if (isNew && session.role === ROLE.PRINCIPAL) throw forbid_();

    let claim = isNew ? null : findBy_(SHEET.CLAIMS, 'ClaimID', payload.claimId);
    if (!isNew && !claim) throw new Error('Claim not found.');
    if (claim) {
      guardTestScope_(session, claim);
      if (!canEditClaimFields_(session, claim)) {
        throw forbid_('This claim can no longer be edited at its current status.');
      }
    }

    const customer = resolveCustomer_(session, payload.customerId);
    const serial = String(payload.serialNumber || '').trim().toUpperCase();
    const warranty = determineWarranty_(serial);

    // An administrator changing the serial number is changing the basis of the
    // warranty decision, so it cannot be done without saying why.
    if (claim && session.role === ROLE.ADMIN && serial !== String(claim.SerialNumber || '').toUpperCase()
      && !String(payload.reason || '').trim()) {
      throw new Error('Changing the serial number requires a reason — it determines the warranty result.');
    }

    const fields = {
      CustomerID: customer.CustomerID,
      CustomerName: customer.Name,
      SerialNumber: serial,
      ProductName: productName_(serial),
      AssemblyMonth: warranty.assemblyMonth,
      Principal: principalFor_(serial),
      ProblemDescription: String(payload.problem || '').trim(),
      UpdatedAt: nowIso_(),
      UpdatedBy: session.email
    };

    // An administrator can attribute a claim the population sheet cannot place.
    if (session.role === ROLE.ADMIN && payload.principal !== undefined) {
      const wanted = String(payload.principal || '').trim();
      if (wanted && principalNames_().indexOf(wanted) === -1) {
        throw new Error('"' + wanted + '" is not an active principal.');
      }
      fields.Principal = wanted;
    } else if (claim && claim.Principal && !fields.Principal) {
      // Keep an attribution already made by hand when the sheet still cannot
      // supply one.
      fields.Principal = claim.Principal;
    }

    // A manual override stands until the serial number itself changes.
    if (!claim || !isTrue_(claim.WarrantyOverridden) ||
      serial !== String(claim.SerialNumber || '').toUpperCase()) {
      fields.WarrantyType = warranty.type;
      fields.WarrantyExpiry = warranty.expiry;
      fields.WarrantyBasis = warranty.basis;
      fields.WarrantyOverridden = false;
      fields.WarrantyOverrideReason = '';
    }

    if (isNew) {
      const claimId = nextId_(SHEET.CLAIMS, 'ClaimID', isTest ? 'TEST' : 'CLM');
      claim = Object.assign({
        ClaimID: claimId,
        RefNo: '',
        IsTest: isTest,
        Status: STATUS.DRAFT,
        RequesterEmail: session.email,
        RequesterName: session.name,
        CreatedAt: nowIso_(),
        SubmittedAt: '', ForwardedAt: '', PrincipalNotifiedAt: '', ClosedAt: '',
        ReturnReason: '', DriveFolderId: '',
        Deleted: false, DeletedBy: '', DeletedAt: '',
        RowVersion: 1
      }, fields);
      insert_(SHEET.CLAIMS, claim);
      claim.DriveFolderId = claimFolder_(claim).getId();
      update_(SHEET.CLAIMS, 'ClaimID', claimId, { DriveFolderId: claim.DriveFolderId });
      audit_(session, 'Create', { claimId: claimId, isTest: isTest });
    } else {
      const changes = [];
      Object.keys(fields).forEach(function (k) {
        if (['UpdatedAt', 'UpdatedBy'].indexOf(k) !== -1) return;
        if (String(claim[k] || '') !== String(fields[k] || '')) {
          changes.push({ field: k, oldValue: claim[k], newValue: fields[k] });
        }
      });

      claim = update_(SHEET.CLAIMS, 'ClaimID', claim.ClaimID, fields, payload.rowVersion);

      const action = (session.role === ROLE.ADMIN && claim.Status === STATUS.SUBMITTED)
        ? 'Amend' : 'SaveDraft';
      auditChanges_(session, action, claim.ClaimID, changes, payload.reason, isTrue_(claim.IsTest));

      if (action === 'Amend' && changes.length) {
        notifyAmendment_(session, claim, changes, payload.reason);
      }
    }

    syncItems_(session, claim, payload.items || []);
    return getClaim_(session, claim.ClaimID);
  });
}

function resolveCustomer_(session, customerId) {
  if (session.role === ROLE.PRODUCTION) {
    const internal = readAll_(SHEET.CUSTOMER).filter(function (c) {
      return c.Name === PRODUCTION_CUSTOMER;
    })[0];
    if (!internal) throw new Error('The "' + PRODUCTION_CUSTOMER + '" customer entry is missing.');
    return internal;
  }
  const customer = findBy_(SHEET.CUSTOMER, 'CustomerID', customerId);
  if (!customer) throw new Error('Please select a customer.');
  if (!isTrue_(customer.Active)) throw new Error('That customer is no longer active.');
  return customer;
}

/** Adds, updates and removes item rows so they match what the form submitted. */
function syncItems_(session, claim, wanted) {
  const existing = readLive_(SHEET.ITEMS).filter(function (i) { return i.ClaimID === claim.ClaimID; });
  const keep = {};

  // The master list is read once, not once per row: findBy_ would re-read the
  // whole spare-part sheet for every part on the claim.
  const parts = {};
  readAll_(SHEET.PART).forEach(function (p) { parts[String(p.PartID)] = p; });

  const seenParts = {};
  wanted.forEach(function (w) {
    if (!w.partId) throw new Error('Please choose a spare part for every row.');
    if (seenParts[w.partId]) throw new Error('The same spare part cannot appear twice on one claim.');
    seenParts[w.partId] = true;
  });

  wanted.forEach(function (w, index) {
    const part = parts[String(w.partId)];
    if (!part) throw new Error('Unknown spare part.');
    const qty = Math.max(1, Number(w.qty || 1));

    const current = w.itemId
      ? existing.filter(function (i) { return i.ItemID === w.itemId; })[0]
      : null;

    if (current) {
      keep[current.ItemID] = true;
      const changes = [];
      if (current.PartID !== part.PartID) {
        changes.push({ field: 'PartName', oldValue: current.PartName, newValue: part.Name,
          itemId: current.ItemID });
      }
      if (Number(current.Qty) !== qty) {
        changes.push({ field: 'Qty', oldValue: current.Qty, newValue: qty, itemId: current.ItemID });
      }
      const patch = {
        PartID: part.PartID, PartName: part.Name, Qty: qty,
        UpdatedAt: nowIso_(), UpdatedBy: session.email
      };

      // The advance-issue flag is deliberately not touched here. It records
      // what the administrator shipped from local stock, and editing the claim
      // — which a requester may do while it is theirs — must not disturb it.
      if (changes.length) {
        update_(SHEET.ITEMS, 'ItemID', current.ItemID, patch);
        auditChanges_(session, 'SaveDraft', claim.ClaimID, changes, '', isTrue_(claim.IsTest));
      }
    } else {
      const itemId = claim.ClaimID.replace(/^(CLM|TEST)-/, 'ITM-') + '-' + padLeft_(index + 1, 2);
      insert_(SHEET.ITEMS, {
        ItemID: itemId,
        ClaimID: claim.ClaimID,
        PartID: part.PartID,
        PartName: part.Name,
        Qty: qty,
        ItemStatus: ITEM_STATUS.PENDING,
        AdvanceIssued: false,
        AdvanceIssuedAt: '', AdvanceIssuedBy: '', AdvanceNote: '',
        DecisionBy: '', DecisionAt: '', DecisionReason: '',
        AvailabilityDate: '', DocumentRefNo: '',
        ForwardedAt: '', ForwardedTo: '', ShippedAt: '', ShippedBy: '',
        PartReturnNote: '', PartReturnAt: '',
        Deleted: false, UpdatedAt: nowIso_(), UpdatedBy: session.email, RowVersion: 1
      });
      keep[itemId] = true;
    }
  });

  existing.forEach(function (i) {
    if (keep[i.ItemID]) return;
    if (i.ItemStatus !== ITEM_STATUS.PENDING) {
      throw new Error('A spare part that has already been decided cannot be removed.');
    }
    update_(SHEET.ITEMS, 'ItemID', i.ItemID, {
      Deleted: true, UpdatedAt: nowIso_(), UpdatedBy: session.email
    });
    audit_(session, 'Delete', {
      claimId: claim.ClaimID, itemId: i.ItemID, field: 'PartName',
      oldValue: i.PartName, isTest: isTrue_(claim.IsTest)
    });
  });
}

/** Stores one uploaded file against a draft or returned claim. */
function uploadAttachment_(session, payload) {
  const claim = findBy_(SHEET.CLAIMS, 'ClaimID', payload.claimId);
  if (!claim) throw new Error('Claim not found.');
  guardTestScope_(session, claim);
  if (!canEditClaimFields_(session, claim)) {
    throw forbid_('This claim can no longer be edited at its current status.');
  }

  let partName = '';
  let index = 1;
  if (payload.kind === ATTACHMENT_KIND.PART) {
    const items = readLive_(SHEET.ITEMS).filter(function (i) { return i.ClaimID === claim.ClaimID; });
    const item = items.filter(function (i) { return i.ItemID === payload.itemId; })[0];
    if (!item) throw new Error('Unknown spare part row for this photo.');
    partName = item.PartName;
    index = items.indexOf(item) + 1;
  }

  return withLock_(function () {
    return saveAttachment_(session, claim, {
      kind: payload.kind,
      itemId: payload.itemId || '',
      data: payload.data,
      fileName: payload.fileName,
      mimeType: payload.mimeType,
      partName: partName,
      index: index
    });
  });
}

/* ----------------------------------------------------------- transitions */

function submitClaim_(session, payload) {
  requireRole_(session, [ROLE.REQUESTER, ROLE.PRODUCTION]);

  return withLock_(function () {
    const claim = findBy_(SHEET.CLAIMS, 'ClaimID', payload.claimId);
    if (!claim) throw new Error('Claim not found.');
    guardTestScope_(session, claim);
    if ([STATUS.DRAFT, STATUS.RETURNED].indexOf(claim.Status) === -1) {
      throw forbid_('This claim has already been submitted.');
    }
    if (String(claim.RequesterEmail).toLowerCase() !== session.email) throw forbid_();

    const items = readLive_(SHEET.ITEMS).filter(function (i) { return i.ClaimID === claim.ClaimID; });
    const attachments = readAll_(SHEET.ATTACHMENTS).filter(function (a) {
      return a.ClaimID === claim.ClaimID && !isTrue_(a.Superseded);
    });

    const problems = [];
    if (!claim.CustomerID) problems.push('a customer');
    if (!claim.SerialNumber) problems.push('a serial number');
    if (!String(claim.ProblemDescription || '').trim()) problems.push('a problem description');
    if (!items.length) problems.push('at least one spare part');
    if (!attachments.some(function (a) { return a.Kind === ATTACHMENT_KIND.FAULT; })) {
      problems.push('a fault photo');
    }
    if (!attachments.some(function (a) { return a.Kind === ATTACHMENT_KIND.REPORT; })) {
      problems.push('a service report');
    }
    items.forEach(function (i) {
      const has = attachments.some(function (a) {
        return a.Kind === ATTACHMENT_KIND.PART && a.ItemID === i.ItemID;
      });
      if (!has) problems.push('a photo for ' + i.PartName);
    });
    if (problems.length) {
      throw new Error('This claim still needs ' + problems.join(', ') + '.');
    }

    // The reference number belongs to the day of submission, not the day the
    // draft was started, or the principal's daily batch would contain claims
    // that were not submitted that day.
    const refNo = todayRef_(isTrue_(claim.IsTest));
    const updated = update_(SHEET.CLAIMS, 'ClaimID', claim.ClaimID, {
      RefNo: refNo,
      Status: STATUS.SUBMITTED,
      SubmittedAt: nowIso_(),
      ReturnReason: '',
      UpdatedAt: nowIso_(),
      UpdatedBy: session.email
    }, payload.rowVersion);

    const folderId = fileClaimOnSubmit_(updated);
    update_(SHEET.CLAIMS, 'ClaimID', claim.ClaimID, { DriveFolderId: folderId });

    audit_(session, 'Submit', {
      claimId: claim.ClaimID, field: 'Status', oldValue: claim.Status,
      newValue: STATUS.SUBMITTED, isTest: isTrue_(claim.IsTest)
    });

    sendMail_({
      code: TEMPLATE.CLAIM_SUBMIT,
      to: adminEmails_(),
      refNo: refNo,
      claimIds: [claim.ClaimID],
      isTest: isTrue_(claim.IsTest),
      testRedirectTo: session.email,
      linkQuery: 'page=claim&id=' + claim.ClaimID,
      linkLabel: 'Open this claim',
      data: claimMailData_(updated, items)
    });

    return getClaim_(session, claim.ClaimID);
  });
}

function returnClaim_(session, payload) {
  requireRole_(session, [ROLE.ADMIN]);
  const reason = String(payload.reason || '').trim();
  if (!reason) throw new Error('Please say why the claim is being returned.');

  return withLock_(function () {
    const claim = findBy_(SHEET.CLAIMS, 'ClaimID', payload.claimId);
    if (!claim) throw new Error('Claim not found.');
    guardTestScope_(session, claim);
    if ([STATUS.SUBMITTED, STATUS.INTERNAL].indexOf(claim.Status) === -1) {
      throw forbid_('Only a submitted claim can be returned.');
    }

    const updated = update_(SHEET.CLAIMS, 'ClaimID', claim.ClaimID, {
      Status: STATUS.RETURNED, ReturnReason: reason,
      UpdatedAt: nowIso_(), UpdatedBy: session.email
    }, payload.rowVersion);

    audit_(session, 'Return', {
      claimId: claim.ClaimID, field: 'Status', oldValue: claim.Status,
      newValue: STATUS.RETURNED, reason: reason, isTest: isTrue_(claim.IsTest)
    });

    const items = readLive_(SHEET.ITEMS).filter(function (i) { return i.ClaimID === claim.ClaimID; });
    const data = claimMailData_(updated, items);
    data.ReturnReason = reason;

    sendMail_({
      code: TEMPLATE.CLAIM_RETURN,
      to: [claim.RequesterEmail],
      refNo: claim.RefNo,
      claimIds: [claim.ClaimID],
      isTest: isTrue_(claim.IsTest),
      testRedirectTo: session.email,
      linkQuery: 'page=claim&id=' + claim.ClaimID,
      linkLabel: 'Revise this claim',
      data: data
    });

    return getClaim_(session, claim.ClaimID);
  });
}

function overrideWarranty_(session, payload) {
  requireRole_(session, [ROLE.ADMIN]);
  const reason = String(payload.reason || '').trim();
  if (!reason) throw new Error('An override must state its reason.');
  const type = payload.warrantyType;
  if ([WARRANTY_TYPE.PRINCIPAL, WARRANTY_TYPE.OUT, WARRANTY_TYPE.INTERNAL,
    WARRANTY_TYPE.MANUAL].indexOf(type) === -1) {
    throw new Error('Unknown warranty type.');
  }

  return withLock_(function () {
    const claim = findBy_(SHEET.CLAIMS, 'ClaimID', payload.claimId);
    if (!claim) throw new Error('Claim not found.');
    guardTestScope_(session, claim);
    if ([STATUS.SUBMITTED, STATUS.INTERNAL].indexOf(claim.Status) === -1) {
      throw forbid_('The warranty can only be overridden before the claim is forwarded.');
    }

    update_(SHEET.CLAIMS, 'ClaimID', claim.ClaimID, {
      WarrantyType: type,
      WarrantyBasis: claim.WarrantyBasis + ' · overridden by administrator',
      WarrantyOverridden: true,
      WarrantyOverrideReason: reason,
      UpdatedAt: nowIso_(), UpdatedBy: session.email
    }, payload.rowVersion);

    audit_(session, 'WarrantyOverride', {
      claimId: claim.ClaimID, field: 'WarrantyType',
      oldValue: claim.WarrantyType, newValue: type, reason: reason,
      isTest: isTrue_(claim.IsTest)
    });
    return getClaim_(session, claim.ClaimID);
  });
}

function forwardToPrincipal_(session, payload) {
  requireRole_(session, [ROLE.ADMIN]);

  return withLock_(function () {
    const claim = findBy_(SHEET.CLAIMS, 'ClaimID', payload.claimId);
    if (!claim) throw new Error('Claim not found.');
    guardTestScope_(session, claim);
    if (claim.Status !== STATUS.SUBMITTED) throw forbid_('Only a submitted claim can be forwarded.');
    if (claim.WarrantyType !== WARRANTY_TYPE.PRINCIPAL) {
      throw new Error('This unit is not under principal warranty. Process it as an internal warranty claim.');
    }
    if (!String(claim.Principal || '').trim()) {
      throw new Error('This unit is not attributed to a principal, so there is nobody to forward it ' +
        'to. Set the principal on the claim first.');
    }
    if (!String(payload.workOrderNo || claim.WorkOrderNo || '').trim()) {
      throw new Error('Enter the work order number before forwarding to the principal.');
    }

    const workOrder = String(payload.workOrderNo || claim.WorkOrderNo).trim();
    if (workOrder !== String(claim.WorkOrderNo || '')) {
      audit_(session, 'Amend', {
        claimId: claim.ClaimID, field: 'WorkOrderNo',
        oldValue: claim.WorkOrderNo, newValue: workOrder, isTest: isTrue_(claim.IsTest)
      });
    }

    update_(SHEET.CLAIMS, 'ClaimID', claim.ClaimID, {
      WorkOrderNo: workOrder,
      Status: STATUS.IN_REVIEW,
      ForwardedAt: nowIso_(),
      UpdatedAt: nowIso_(), UpdatedBy: session.email
    }, payload.rowVersion);

    audit_(session, 'ForwardToPrincipal', {
      claimId: claim.ClaimID, field: 'Status', oldValue: claim.Status,
      newValue: STATUS.IN_REVIEW, isTest: isTrue_(claim.IsTest)
    });

    // The principal sees this immediately in the portal; only the notification
    // waits for the evening digest.
    return getClaim_(session, claim.ClaimID);
  });
}

function withdrawFromPrincipal_(session, payload) {
  requireRole_(session, [ROLE.ADMIN]);

  return withLock_(function () {
    const claim = findBy_(SHEET.CLAIMS, 'ClaimID', payload.claimId);
    if (!claim) throw new Error('Claim not found.');
    guardTestScope_(session, claim);
    if (claim.Status !== STATUS.IN_REVIEW) throw forbid_();

    const items = readLive_(SHEET.ITEMS).filter(function (i) { return i.ClaimID === claim.ClaimID; });
    if (items.some(function (i) { return i.ItemStatus !== ITEM_STATUS.PENDING; })) {
      throw new Error('A claim the principal has already decided on cannot be withdrawn.');
    }

    update_(SHEET.CLAIMS, 'ClaimID', claim.ClaimID, {
      Status: STATUS.SUBMITTED, ForwardedAt: '', PrincipalNotifiedAt: '',
      UpdatedAt: nowIso_(), UpdatedBy: session.email
    }, payload.rowVersion);

    audit_(session, 'Withdraw', {
      claimId: claim.ClaimID, field: 'Status', oldValue: STATUS.IN_REVIEW,
      newValue: STATUS.SUBMITTED, reason: payload.reason || '', isTest: isTrue_(claim.IsTest)
    });
    return getClaim_(session, claim.ClaimID);
  });
}

/** Moves an out-of-warranty claim onto the internal track. */
function startInternalVerification_(session, payload) {
  requireRole_(session, [ROLE.ADMIN]);

  return withLock_(function () {
    const claim = findBy_(SHEET.CLAIMS, 'ClaimID', payload.claimId);
    if (!claim) throw new Error('Claim not found.');
    guardTestScope_(session, claim);
    if (claim.Status !== STATUS.SUBMITTED) throw forbid_();

    update_(SHEET.CLAIMS, 'ClaimID', claim.ClaimID, {
      Status: STATUS.INTERNAL,
      WorkOrderNo: String(payload.workOrderNo || claim.WorkOrderNo || '').trim(),
      UpdatedAt: nowIso_(), UpdatedBy: session.email
    }, payload.rowVersion);

    audit_(session, 'Amend', {
      claimId: claim.ClaimID, field: 'Status', oldValue: claim.Status,
      newValue: STATUS.INTERNAL, isTest: isTrue_(claim.IsTest)
    });
    return getClaim_(session, claim.ClaimID);
  });
}

/**
 * Records a decision on one or more items. The principal decides on the
 * principal-warranty track; the administrator decides on the internal track.
 */
function decideItems_(session, payload) {
  requireRole_(session, [ROLE.PRINCIPAL, ROLE.ADMIN]);
  const approve = payload.decision === 'approve';
  const reason = String(payload.reason || '').trim();
  if (!approve && !reason) throw new Error('A rejection must state its reason.');

  return withLock_(function () {
    const items = readLive_(SHEET.ITEMS);
    const targets = items.filter(function (i) { return payload.itemIds.indexOf(i.ItemID) !== -1; });
    if (!targets.length) throw new Error('No spare parts were selected.');

    const touched = {};
    targets.forEach(function (item) {
      const claim = findBy_(SHEET.CLAIMS, 'ClaimID', item.ClaimID);
      guardTestScope_(session, claim);

      if (session.role === ROLE.PRINCIPAL) {
        if (claim.WarrantyType !== WARRANTY_TYPE.PRINCIPAL) throw forbid_();
        if ([STATUS.IN_REVIEW, STATUS.FULFILMENT, STATUS.CLOSED].indexOf(claim.Status) === -1) {
          throw forbid_();
        }
      } else if (claim.Status !== STATUS.INTERNAL && claim.Status !== STATUS.FULFILMENT) {
        throw forbid_('Administrators decide only on internal warranty claims.');
      }
      if ([ITEM_STATUS.FORWARDED, ITEM_STATUS.AWAITING, ITEM_STATUS.SHIPPED]
        .indexOf(item.ItemStatus) !== -1) {
        throw new Error('A part that has already been ordered cannot be re-decided.');
      }

      const changed = item.ItemStatus !== ITEM_STATUS.PENDING;
      if (changed && !reason) {
        throw new Error('Changing a decision requires a reason.');
      }

      update_(SHEET.ITEMS, 'ItemID', item.ItemID, {
        ItemStatus: approve ? ITEM_STATUS.APPROVED : ITEM_STATUS.REJECTED,
        DecisionBy: session.email,
        DecisionAt: nowIso_(),
        DecisionReason: reason,
        UpdatedAt: nowIso_(), UpdatedBy: session.email
      });

      audit_(session, changed ? 'ChangeDecision' : 'PrincipalDecision', {
        claimId: item.ClaimID, itemId: item.ItemID, field: 'ItemStatus',
        oldValue: item.ItemStatus, newValue: approve ? ITEM_STATUS.APPROVED : ITEM_STATUS.REJECTED,
        reason: reason, isTest: isTrue_(claim.IsTest)
      });
      touched[item.ClaimID] = true;
    });

    Object.keys(touched).forEach(function (claimId) {
      const settled = recomputeClaimStatus_(session, claimId);
      if (settled.notify) notifyDecision_(session, claimId);
    });

    return { ok: true, claimIds: Object.keys(touched) };
  });
}

/**
 * Re-derives the claim's workflow position from its items and reports whether
 * this call is the one that settled it.
 */
function recomputeClaimStatus_(session, claimId) {
  const claim = findBy_(SHEET.CLAIMS, 'ClaimID', claimId);
  const items = readLive_(SHEET.ITEMS).filter(function (i) { return i.ClaimID === claimId; });
  if (!items.length) return { notify: false };

  const pending = items.filter(function (i) { return i.ItemStatus === ITEM_STATUS.PENDING; }).length;
  const approvedLike = items.filter(function (i) {
    return [ITEM_STATUS.APPROVED, ITEM_STATUS.FORWARDED, ITEM_STATUS.AWAITING].indexOf(i.ItemStatus) !== -1;
  }).length;
  const shipped = items.filter(function (i) { return i.ItemStatus === ITEM_STATUS.SHIPPED; }).length;

  // A replacement has gone out and the faulty part has not come back. Closing
  // here would erase the only record that something is still owed — and a part
  // sent without its old one returned is exactly what goes missing.
  const awaitingReturn = items.filter(function (i) {
    return i.ItemStatus === ITEM_STATUS.SHIPPED && !String(i.PartReturnAt || '').trim();
  }).length;

  let next = claim.Status;
  let notify = false;

  if (pending === 0) {
    // Nothing left awaiting delivery — either every part was rejected, or every
    // approved part has shipped.
    next = approvedLike === 0 ? STATUS.CLOSED : STATUS.FULFILMENT;
    notify = [STATUS.IN_REVIEW, STATUS.INTERNAL].indexOf(claim.Status) !== -1;
    // A claim where everything was rejected still closes: nothing was ever sent.
    if (next === STATUS.CLOSED && awaitingReturn) next = STATUS.FULFILMENT;
  }

  if (next !== claim.Status) {
    const changes = { Status: next, UpdatedAt: nowIso_(), UpdatedBy: session.email };
    if (next === STATUS.CLOSED) changes.ClosedAt = nowIso_();
    update_(SHEET.CLAIMS, 'ClaimID', claimId, changes);
    audit_(session, 'Amend', {
      claimId: claimId, field: 'Status', oldValue: claim.Status, newValue: next,
      isTest: isTrue_(claim.IsTest)
    });
  }
  return { notify: notify, status: next, awaitingReturn: awaitingReturn };
}

/* ---------------------------------------------------------- fulfilment */

function setAvailability_(session, payload) {
  requireRole_(session, [ROLE.ADMIN]);
  const date = String(payload.availabilityDate || '').trim();
  const docRef = String(payload.documentRefNo || '').trim();
  if (!date || !docRef) throw new Error('Enter both the availability date and the document reference.');
  // A purchase request is the same shape as a principal order — a number and a
  // date to expect it by — so it is the same transition, differently routed.
  const route = payload.route === FULFILMENT.PR ? FULFILMENT.PR : FULFILMENT.PRINCIPAL;

  return withLock_(function () {
    const items = readLive_(SHEET.ITEMS).filter(function (i) {
      return payload.itemIds.indexOf(i.ItemID) !== -1;
    });
    if (!items.length) throw new Error('No spare parts were selected.');

    items.forEach(function (item) {
      const claim = findBy_(SHEET.CLAIMS, 'ClaimID', item.ClaimID);
      guardTestScope_(session, claim);
      if ([ITEM_STATUS.APPROVED, ITEM_STATUS.FORWARDED, ITEM_STATUS.AWAITING]
        .indexOf(item.ItemStatus) === -1) {
        throw new Error('Only approved parts can be scheduled.');
      }
      update_(SHEET.ITEMS, 'ItemID', item.ItemID, {
        AvailabilityDate: date, DocumentRefNo: docRef,
        FulfilmentRoute: item.FulfilmentRoute || route,
        ItemStatus: ITEM_STATUS.AWAITING,
        UpdatedAt: nowIso_(), UpdatedBy: session.email
      });
      audit_(session, 'SetAvailability', {
        claimId: item.ClaimID, itemId: item.ItemID, field: 'AvailabilityDate',
        oldValue: item.AvailabilityDate, newValue: date + ' / ' + docRef,
        isTest: isTrue_(claim.IsTest)
      });
    });
    return { ok: true, count: items.length };
  });
}

function forwardOrder_(session, payload) {
  requireRole_(session, [ROLE.ADMIN]);

  return withLock_(function () {
    const items = readLive_(SHEET.ITEMS).filter(function (i) {
      return payload.itemIds.indexOf(i.ItemID) !== -1;
    });
    if (!items.length) throw new Error('No spare parts were selected.');

    const recipients = readAll_(SHEET.RECIPIENTS).filter(function (r) {
      return (payload.recipientIds || []).indexOf(String(r.RecipientID)) !== -1 && isTrue_(r.Active);
    });
    if (!recipients.length) throw new Error('Choose at least one recipient.');

    const claims = {};
    const rows = items.map(function (item) {
      const claim = findBy_(SHEET.CLAIMS, 'ClaimID', item.ClaimID);
      guardTestScope_(session, claim);
      if (item.ItemStatus !== ITEM_STATUS.APPROVED) {
        throw new Error('Only approved parts that have not yet been forwarded can be sent.');
      }
      // A unit out of principal warranty is not the principal's to supply, so
      // the part never reaches their order list — it is raised as a purchase
      // request or taken from stock instead.
      if (claim.WarrantyType !== WARRANTY_TYPE.PRINCIPAL) {
        throw new Error(claim.ClaimID + ' is not under principal warranty — ' +
          'raise a purchase request or fulfil it from stock instead.');
      }
      claims[claim.ClaimID] = claim;
      return {
        PartName: item.PartName, Qty: item.Qty, ClaimID: claim.ClaimID,
        Customer: claim.CustomerName, SerialNumber: claim.SerialNumber,
        WorkOrder: claim.WorkOrderNo
      };
    });

    const to = recipients.map(function (r) { return r.Email; });
    const refNos = {};
    Object.keys(claims).forEach(function (id) { refNos[claims[id].RefNo] = true; });
    const refNo = Object.keys(refNos).join(', ');
    const anyTest = Object.keys(claims).some(function (id) { return isTrue_(claims[id].IsTest); });

    sendMail_({
      code: TEMPLATE.ORDER_FORWARD,
      to: to,
      cc: payload.cc || [],
      refNo: refNo,
      claimIds: Object.keys(claims),
      isTest: anyTest,
      testRedirectTo: session.email,
      linkQuery: 'page=orders',
      linkLabel: 'Open the order list',
      data: {
        RefNo: refNo, PartCount: rows.length, Items: rows,
        ForwardedBy: session.email,
        ForwardedAt: Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy HH:mm')
      }
    });

    items.forEach(function (item) {
      update_(SHEET.ITEMS, 'ItemID', item.ItemID, {
        ItemStatus: ITEM_STATUS.FORWARDED,
        ForwardedAt: nowIso_(), ForwardedTo: to.join(', '),
        UpdatedAt: nowIso_(), UpdatedBy: session.email
      });
      audit_(session, 'ForwardOrder', {
        claimId: item.ClaimID, itemId: item.ItemID, field: 'ItemStatus',
        oldValue: item.ItemStatus, newValue: ITEM_STATUS.FORWARDED, reason: to.join(', '),
        isTest: isTrue_(claims[item.ClaimID].IsTest)
      });
    });

    return { ok: true, count: items.length, to: to };
  });
}

/**
 * Marks approved parts as coming off the shelf rather than being ordered.
 *
 * Recorded first and shipped afterwards, deliberately: the part is on the shelf
 * but it has not moved yet, and the shipping date should say when it did.
 */
function fulfilFromStock_(session, payload) {
  requireRole_(session, [ROLE.ADMIN]);

  return withLock_(function () {
    const items = readLive_(SHEET.ITEMS).filter(function (i) {
      return payload.itemIds.indexOf(i.ItemID) !== -1;
    });
    if (!items.length) throw new Error('No spare parts were selected.');

    const note = String(payload.note || '').trim();
    const date = String(payload.availabilityDate || '').trim();

    items.forEach(function (item) {
      const claim = findBy_(SHEET.CLAIMS, 'ClaimID', item.ClaimID);
      guardTestScope_(session, claim);
      if ([ITEM_STATUS.APPROVED, ITEM_STATUS.AWAITING].indexOf(item.ItemStatus) === -1) {
        throw new Error('Only an approved part can be fulfilled from stock.');
      }
      update_(SHEET.ITEMS, 'ItemID', item.ItemID, {
        FulfilmentRoute: FULFILMENT.STOCK,
        ItemStatus: ITEM_STATUS.AWAITING,
        AvailabilityDate: date || item.AvailabilityDate,
        DocumentRefNo: note || item.DocumentRefNo,
        UpdatedAt: nowIso_(), UpdatedBy: session.email
      });
      audit_(session, 'SetAvailability', {
        claimId: item.ClaimID, itemId: item.ItemID, field: 'FulfilmentRoute',
        oldValue: item.FulfilmentRoute, newValue: FULFILMENT.STOCK, reason: note,
        isTest: isTrue_(claim.IsTest)
      });
    });
    return { ok: true, count: items.length };
  });
}

function markShipped_(session, payload) {
  requireRole_(session, [ROLE.ADMIN]);

  return withLock_(function () {
    const items = readLive_(SHEET.ITEMS).filter(function (i) {
      return payload.itemIds.indexOf(i.ItemID) !== -1;
    });
    if (!items.length) throw new Error('No spare parts were selected.');

    const touched = {};
    items.forEach(function (item) {
      const claim = findBy_(SHEET.CLAIMS, 'ClaimID', item.ClaimID);
      guardTestScope_(session, claim);
      if ([ITEM_STATUS.APPROVED, ITEM_STATUS.FORWARDED, ITEM_STATUS.AWAITING]
        .indexOf(item.ItemStatus) === -1) {
        throw new Error('Only an approved part can be marked as shipped.');
      }
      update_(SHEET.ITEMS, 'ItemID', item.ItemID, {
        ItemStatus: ITEM_STATUS.SHIPPED, ShippedAt: nowIso_(), ShippedBy: session.email,
        UpdatedAt: nowIso_(), UpdatedBy: session.email
      });
      audit_(session, 'MarkShipped', {
        claimId: item.ClaimID, itemId: item.ItemID, field: 'ItemStatus',
        oldValue: item.ItemStatus, newValue: ITEM_STATUS.SHIPPED, isTest: isTrue_(claim.IsTest)
      });
      touched[item.ClaimID] = true;
    });

    Object.keys(touched).forEach(function (id) { recomputeClaimStatus_(session, id); });
    return { ok: true, count: items.length };
  });
}

/**
 * Records that a part was shipped from local stock before the principal decided,
 * because the machine could not wait.
 *
 * This is the administrator's decision alone: the stock is theirs, and only they
 * know whether a part went out of it. The requester asks for a part and never
 * sees this flag on the form — they have no way of knowing what was on the shelf.
 *
 * The claim itself carries on unchanged — the flag says the customer already has
 * the part, so what eventually arrives from the principal replenishes stock
 * rather than travelling to the hospital. It also marks where the cost lands if
 * the claim is later rejected.
 */
function setAdvanceIssue_(session, payload) {
  requireRole_(session, [ROLE.ADMIN]);

  return withLock_(function () {
    const items = readLive_(SHEET.ITEMS).filter(function (i) {
      return payload.itemIds.indexOf(i.ItemID) !== -1;
    });
    if (!items.length) throw new Error('No spare parts were selected.');

    const issued = payload.issued !== false;
    const note = String(payload.note || '').trim();

    items.forEach(function (item) {
      const claim = findBy_(SHEET.CLAIMS, 'ClaimID', item.ClaimID);
      guardTestScope_(session, claim);

      if (claim.Status === STATUS.CLOSED) throw forbid_('This claim is already closed.');

      update_(SHEET.ITEMS, 'ItemID', item.ItemID, {
        AdvanceIssued: issued,
        AdvanceIssuedAt: issued ? nowIso_() : '',
        AdvanceIssuedBy: issued ? session.email : '',
        AdvanceNote: issued ? note : '',
        UpdatedAt: nowIso_(), UpdatedBy: session.email
      });

      audit_(session, 'AdvanceIssue', {
        claimId: item.ClaimID, itemId: item.ItemID, field: 'AdvanceIssued',
        oldValue: isTrue_(item.AdvanceIssued), newValue: issued, reason: note,
        isTest: isTrue_(claim.IsTest)
      });
    });

    return { ok: true, count: items.length };
  });
}

function recordPartReturn_(session, payload) {
  requireRole_(session, [ROLE.ADMIN]);

  return withLock_(function () {
    const item = findBy_(SHEET.ITEMS, 'ItemID', payload.itemId);
    if (!item) throw new Error('Spare part not found.');
    const claim = findBy_(SHEET.CLAIMS, 'ClaimID', item.ClaimID);
    guardTestScope_(session, claim);

    update_(SHEET.ITEMS, 'ItemID', item.ItemID, {
      PartReturnNote: String(payload.note || '').trim(), PartReturnAt: nowIso_(),
      UpdatedAt: nowIso_(), UpdatedBy: session.email
    });
    audit_(session, 'RecordPartReturn', {
      claimId: item.ClaimID, itemId: item.ItemID, field: 'PartReturnNote',
      oldValue: item.PartReturnNote, newValue: payload.note, isTest: isTrue_(claim.IsTest)
    });
    // The outstanding return may have been the only thing holding the claim
    // open, so this is the moment it can finish.
    recomputeClaimStatus_(session, item.ClaimID);
    return getClaim_(session, item.ClaimID);
  });
}

/* ------------------------------------------------------------- deletion */

/** Marks a claim deleted. Nothing is ever removed from the sheet. */
function deleteClaim_(session, payload) {
  return withLock_(function () {
    const claim = findBy_(SHEET.CLAIMS, 'ClaimID', payload.claimId);
    if (!claim) throw new Error('Claim not found.');
    guardTestScope_(session, claim);

    const isOwner = String(claim.RequesterEmail).toLowerCase() === session.email;
    if (session.role === ROLE.ADMIN) {
      if ([STATUS.DRAFT, STATUS.SUBMITTED, STATUS.RETURNED].indexOf(claim.Status) === -1) {
        throw forbid_('A claim that has reached the principal cannot be removed.');
      }
    } else if (!(isOwner && claim.Status === STATUS.DRAFT)) {
      throw forbid_('Only your own draft can be removed.');
    }

    update_(SHEET.CLAIMS, 'ClaimID', claim.ClaimID, {
      Deleted: true, DeletedBy: session.email, DeletedAt: nowIso_(),
      UpdatedAt: nowIso_(), UpdatedBy: session.email
    }, payload.rowVersion);

    audit_(session, 'Delete', {
      claimId: claim.ClaimID, field: 'Deleted', oldValue: false, newValue: true,
      reason: payload.reason || '', isTest: isTrue_(claim.IsTest)
    });
    return { ok: true };
  });
}

/** The one hard delete in the system, and it only ever touches test data. */
function purgeTestClaims_(session) {
  if (!session.isTester) throw forbid_();

  return withLock_(function () {
    const claims = readAll_(SHEET.CLAIMS).filter(function (c) { return isTrue_(c.IsTest); });
    const ids = claims.map(function (c) { return c.ClaimID; });
    deleteRowsWhere_(SHEET.ITEMS, function (r) { return ids.indexOf(r.ClaimID) !== -1; });
    deleteRowsWhere_(SHEET.ATTACHMENTS, function (r) { return ids.indexOf(r.ClaimID) !== -1; });
    deleteRowsWhere_(SHEET.AUDIT, function (r) { return isTrue_(r.IsTest); });
    deleteRowsWhere_(SHEET.EMAIL_LOG, function (r) { return isTrue_(r.IsTest); });
    deleteRowsWhere_(SHEET.CLAIMS, function (r) { return isTrue_(r.IsTest); });
    const folders = purgeTestFolders_();
    return { ok: true, claims: ids.length, folders: folders };
  });
}

function deleteRowsWhere_(name, predicate) {
  const s = sheet_(name);
  const rows = readAll_(name);
  const doomed = rows.filter(predicate).map(function (r) { return r.__row; })
    .sort(function (a, b) { return b - a; });
  doomed.forEach(function (r) { s.deleteRow(r); });
  return doomed.length;
}

/* ------------------------------------------------------ mail composition */

function claimMailData_(claim, items) {
  return {
    ClaimID: claim.ClaimID,
    RefNo: claim.RefNo,
    Principal: claim.Principal || '—',
    Customer: claim.CustomerName,
    SerialNumber: claim.SerialNumber,
    WarrantyBasis: claim.WarrantyBasis,
    WorkOrder: claim.WorkOrderNo || '—',
    Problem: claim.ProblemDescription,
    RequesterName: claim.RequesterName,
    SubmittedAt: claim.SubmittedAt,
    Items: items.map(function (i) {
      return {
        PartName: i.PartName, Qty: i.Qty, ItemStatus: i.ItemStatus,
        DecisionReason: i.DecisionReason || '',
        // Tells the principal the machine is already running on a part supplied
        // locally, so what they send is a replacement for stock.
        AdvanceIssue: isTrue_(i.AdvanceIssued) ? 'already supplied from local stock' : ''
      };
    })
  };
}

function notifyDecision_(session, claimId) {
  const claim = findBy_(SHEET.CLAIMS, 'ClaimID', claimId);
  const items = readLive_(SHEET.ITEMS).filter(function (i) { return i.ClaimID === claimId; });
  const data = claimMailData_(claim, items);
  data.ApprovedCount = items.filter(function (i) {
    return i.ItemStatus !== ITEM_STATUS.REJECTED;
  }).length;
  data.RejectedCount = items.filter(function (i) {
    return i.ItemStatus === ITEM_STATUS.REJECTED;
  }).length;
  data.DecisionBy = session.email;
  data.DecisionAt = Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy HH:mm');

  const common = {
    refNo: claim.RefNo, claimIds: [claimId], isTest: isTrue_(claim.IsTest),
    testRedirectTo: session.email, linkQuery: 'page=claim&id=' + claimId,
    linkLabel: 'Open this claim', data: data
  };

  sendMail_(Object.assign({ code: TEMPLATE.DECISION_REQ, to: [claim.RequesterEmail] }, common));
  sendMail_(Object.assign({ code: TEMPLATE.DECISION_ADM, to: adminEmails_() }, common));
}

function notifyAmendment_(session, claim, changes, reason) {
  const items = readLive_(SHEET.ITEMS).filter(function (i) { return i.ClaimID === claim.ClaimID; });
  const data = claimMailData_(claim, items);
  data.AmendedBy = session.email;
  data.AmendedAt = Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy HH:mm');
  data.Reason = reason || '';
  data.Changes = changes.map(function (c) {
    return {
      Field: humanField_(c.field),
      OldValue: c.oldValue === '' ? '(empty)' : c.oldValue,
      NewValue: c.newValue === '' ? '(empty)' : c.newValue
    };
  });

  sendMail_({
    code: TEMPLATE.CLAIM_AMEND,
    to: [claim.RequesterEmail],
    refNo: claim.RefNo,
    claimIds: [claim.ClaimID],
    isTest: isTrue_(claim.IsTest),
    testRedirectTo: session.email,
    linkQuery: 'page=claim&id=' + claim.ClaimID,
    linkLabel: 'Open this claim',
    data: data
  });
}

function humanField_(field) {
  const map = {
    CustomerName: 'Customer', SerialNumber: 'Serial number',
    ProblemDescription: 'Problem description', WorkOrderNo: 'Work order',
    WarrantyType: 'Warranty', PartName: 'Spare part', Qty: 'Quantity'
  };
  return map[field] || field;
}
