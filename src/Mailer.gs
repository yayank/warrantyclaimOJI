/**
 * Mailer.gs — notifications, which double as the audit record.
 *
 * Each message has to stand on its own three years from now, so the body always
 * carries the working behind the warranty verdict and the identity of whoever
 * verified it. Shortcut links are a convenience on top of that, never a
 * substitute for the content.
 *
 * Header and footer are owned by the system: they hold the reference number,
 * timestamp, template version and log reference. Administrators rewrite the
 * body only, and the placeholders that carry evidentiary weight cannot be
 * removed from it.
 */

const TEMPLATE = {
  CLAIM_SUBMIT: 'CLAIM_SUBMIT',
  DAILY_DIGEST: 'DAILY_DIGEST',
  DECISION_REQ: 'DECISION_REQ',
  DECISION_ADM: 'DECISION_ADM',
  ORDER_FORWARD: 'ORDER_FORWARD',
  CLAIM_RETURN: 'CLAIM_RETURN',
  CLAIM_AMEND: 'CLAIM_AMEND'
};

/**
 * Built-in templates. These ship with the code and remain the fallback whenever
 * a stored template is missing or fails validation, so a broken edit can never
 * result in a blank message going out.
 */
const DEFAULT_TEMPLATES = [
  {
    code: TEMPLATE.CLAIM_SUBMIT,
    name: 'New Submission',
    title: 'NEW WARRANTY CLAIM',
    subject: '[Warranty Claim] New submission {{ClaimID}} — {{Customer}}',
    required: ['{{ClaimID}}', '{{WarrantyBasis}}'],
    body: [
      'A new warranty claim has been submitted and is awaiting verification.',
      '',
      'Claim        {{ClaimID}}',
      'Principal    {{Principal}}',
      'Customer     {{Customer}}',
      'Serial no.   {{SerialNumber}}',
      'Warranty     {{WarrantyBasis}}',
      'Problem      {{Problem}}',
      '',
      'Parts requested',
      '{{#Items}}  · {{PartName}} — {{Qty}} pcs {{AdvanceIssue}}',
      '{{/Items}}',
      'Submitted by {{RequesterName}} on {{SubmittedAt}}.'
    ].join('\n')
  },
  {
    code: TEMPLATE.DAILY_DIGEST,
    name: 'Daily Submission',
    title: 'WARRANTY CLAIM SUBMISSION',
    // A batch belongs to exactly one principal, and the name is carried on the
    // message so a forwarded copy is never ambiguous about whose units these are.
    subject: '[Warranty Claim] Daily Submission {{RefNo}} — {{ClaimCount}} claims',
    required: ['{{ClaimID}}', '{{RefNo}}', '{{WarrantyBasis}}'],
    body: [
      'The following warranty claims have been verified and are submitted for your review.',
      '',
      'Principal: {{Principal}}',
      '',
      '{{#Claims}}',
      'Claim {{ClaimID}} — {{Customer}}',
      '  Serial number   {{SerialNumber}}',
      '  Warranty        {{WarrantyBasis}}',
      '  Work order      {{WorkOrder}}',
      '  Problem         {{Problem}}',
      '  Parts requested',
      '{{#Items}}    · {{PartName}} — {{Qty}} pcs {{AdvanceIssue}}',
      '{{/Items}}',
      '{{/Claims}}',
      'Total {{ClaimCount}} claims, {{PartCount}} parts.',
      'Verified by {{VerifiedBy}}.',
      '',
      'Parts marked as already supplied from local stock are fitted and running;',
      'the replacement replenishes our stock rather than travelling to site.'
    ].join('\n')
  },
  {
    code: TEMPLATE.DECISION_REQ,
    name: 'Decision · Requester',
    title: 'WARRANTY CLAIM DECISION',
    subject: '[Warranty Claim] Decision on {{ClaimID}} — {{ApprovedCount}} approved, {{RejectedCount}} rejected',
    required: ['{{ClaimID}}'],
    body: [
      'A decision has been made on your warranty claim.',
      '',
      'Claim {{ClaimID}} — {{Customer}} — {{SerialNumber}}',
      '',
      '{{#Items}}  {{PartName}} — {{Qty}} pcs — {{ItemStatus}}',
      '    {{DecisionReason}}',
      '{{/Items}}',
      'Availability dates will appear in the portal once confirmed.'
    ].join('\n')
  },
  {
    code: TEMPLATE.DECISION_ADM,
    name: 'Decision · Administrator',
    title: 'PRINCIPAL DECISION',
    subject: '[Warranty Claim] Principal decision — {{ClaimID}}',
    required: ['{{ClaimID}}'],
    body: [
      'Principal has decided on {{ClaimID}} ({{Customer}}, {{SerialNumber}}).',
      '',
      '{{#Items}}  {{PartName}} — {{ItemStatus}} — {{DecisionReason}}',
      '{{/Items}}',
      'Decided by {{DecisionBy}} on {{DecisionAt}}.',
      'Approved parts are ready to be forwarded to the parts recipient.'
    ].join('\n')
  },
  {
    code: TEMPLATE.ORDER_FORWARD,
    name: 'Parts Order',
    title: 'WARRANTY PARTS ORDER',
    subject: '[Warranty Claim] Parts Order {{RefNo}} — {{PartCount}} parts',
    required: ['{{ClaimID}}', '{{RefNo}}'],
    body: [
      'The following parts have been approved under warranty and are requested for delivery.',
      '',
      '{{#Items}}',
      '{{PartName}} — {{Qty}} pcs {{AdvanceIssue}}',
      '  Claim {{ClaimID}} · {{Customer}} · {{SerialNumber}}',
      '  Work order {{WorkOrder}}',
      '{{/Items}}',
      'Please reply with the expected availability date and your document reference number.',
      '',
      'Requested by {{ForwardedBy}} on {{ForwardedAt}}.'
    ].join('\n')
  },
  {
    code: TEMPLATE.CLAIM_RETURN,
    name: 'Action Required',
    title: 'CLAIM RETURNED FOR REVISION',
    subject: '[Warranty Claim] Action required — {{ClaimID}}',
    required: ['{{ClaimID}}', '{{ReturnReason}}'],
    body: [
      'Your claim has been returned for revision.',
      '',
      'Claim  {{ClaimID}} — {{Customer}} — {{SerialNumber}}',
      'Reason {{ReturnReason}}',
      '',
      'Please update the claim and submit it again.'
    ].join('\n')
  },
  {
    code: TEMPLATE.CLAIM_AMEND,
    name: 'Claim Updated',
    title: 'CLAIM AMENDED',
    subject: '[Warranty Claim] Claim updated — {{ClaimID}}',
    required: ['{{ClaimID}}', '{{#Changes}}'],
    body: [
      'Your claim has been amended by the administrator.',
      '',
      'Claim {{ClaimID}} — {{Customer}} — {{SerialNumber}}',
      '',
      '{{#Changes}}  {{Field}}: {{OldValue}} → {{NewValue}}',
      '{{/Changes}}',
      'Amended by {{AmendedBy}} on {{AmendedAt}}.',
      '{{Reason}}'
    ].join('\n')
  }
];

function defaultTemplate_(code) {
  return DEFAULT_TEMPLATES.filter(function (t) { return t.code === code; })[0];
}

/** Stored template if it is valid, otherwise the built-in default. */
function loadTemplate_(code) {
  const fallback = defaultTemplate_(code);
  if (!fallback) throw new Error('Unknown template ' + code);

  const stored = findBy_(SHEET.TEMPLATES, 'TemplateCode', code);
  if (!stored || !isTrue_(stored.Active) || !stored.Body || !stored.Subject) {
    return {
      code: code, name: fallback.name, title: fallback.title,
      subject: fallback.subject, body: fallback.body,
      version: 0, required: fallback.required, isDefault: true
    };
  }
  const missing = missingPlaceholders_(code, stored.Subject + '\n' + stored.Body);
  if (missing.length) {
    return {
      code: code, name: fallback.name, title: fallback.title,
      subject: fallback.subject, body: fallback.body,
      version: 0, required: fallback.required, isDefault: true
    };
  }
  return {
    code: code, name: stored.Name || fallback.name, title: fallback.title,
    subject: stored.Subject, body: stored.Body,
    version: Number(stored.Version || 1), required: fallback.required, isDefault: false
  };
}

function missingPlaceholders_(code, text) {
  const required = defaultTemplate_(code).required;
  return required.filter(function (p) { return String(text).indexOf(p) === -1; });
}

/* ------------------------------------------------------------- rendering */

/**
 * Minimal mustache: {{Field}} substitution and {{#List}}…{{/List}} repetition.
 * Sections may be nested one level, which is all any template needs.
 */
function renderTemplate_(text, data) {
  let out = String(text);

  out = out.replace(/\{\{#([A-Za-z]+)\}\}\n?([\s\S]*?)\{\{\/\1\}\}\n?/g, function (m, key, inner) {
    const list = data[key];
    if (!list || !list.length) return '';
    return list.map(function (row) { return renderTemplate_(inner, row); }).join('');
  });

  out = out.replace(/\{\{([A-Za-z]+)\}\}/g, function (m, key) {
    const v = data[key];
    return (v === undefined || v === null) ? '' : String(v);
  });

  return out;
}

function escapeHtml_(text) {
  return String(text === undefined || text === null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Wraps a rendered body in the locked shell. */
function wrapEmail_(template, bodyText, ctx) {
  const url = setting_(SETTING_KEY.APP_URL, '');
  const link = url && ctx.linkQuery ? url + '?' + ctx.linkQuery : '';
  const generated = Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy, HH:mm') + ' WIB';

  const button = link
    ? '<p style="margin:14px 0 0"><a href="' + escapeHtml_(link) + '" style="display:inline-block;' +
      'background:#00697a;color:#ffffff;text-decoration:none;padding:9px 18px;border-radius:5px;' +
      'font-weight:600;font-size:14px">' + escapeHtml_(ctx.linkLabel || 'Open in portal') + '</a></p>'
    : '';

  return [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#101619;',
    'max-width:660px;margin:0 auto;border:1px solid #d7dee1;border-radius:6px;overflow:hidden">',
    '<div style="background:#f8fafb;border-bottom:1px solid #d7dee1;padding:16px 20px">',
    '<div style="font-weight:700;letter-spacing:.06em;font-size:13px">', escapeHtml_(template.title), '</div>',
    '<div style="color:#6f7c82;font-size:12px;margin-top:4px">',
    ctx.refNo ? 'Ref. ' + escapeHtml_(ctx.refNo) + ' &middot; ' : '',
    'Generated ', escapeHtml_(generated), '</div>',
    button,
    '</div>',
    '<div style="padding:18px 20px;white-space:pre-wrap;line-height:1.6">',
    escapeHtml_(bodyText),
    '</div>',
    '<div style="background:#f8fafb;border-top:1px solid #d7dee1;padding:12px 20px;',
    'color:#6f7c82;font-size:11.5px;line-height:1.6">',
    'This is an automatically generated record. Do not reply.<br>',
    'Template ', escapeHtml_(template.code), ' v', template.version,
    template.isDefault ? ' (default)' : '',
    ' &middot; Log ref ', escapeHtml_(ctx.emailId),
    '</div></div>'
  ].join('');
}

/* --------------------------------------------------------------- sending */

/**
 * Renders, sends and archives one message.
 * In test mode every recipient is replaced by the tester's own address, so
 * exercising "Forward to Principal" never reaches the real principal.
 */
function sendMail_(opts) {
  const template = loadTemplate_(opts.code);
  const emailId = nextId_(SHEET.EMAIL_LOG, 'EmailID', 'EML');
  const isTest = !!opts.isTest;

  const subject = (isTest ? '[TEST] ' : '') + renderTemplate_(template.subject, opts.data);
  const bodyText = renderTemplate_(template.body, opts.data);
  const html = wrapEmail_(template, bodyText, {
    refNo: opts.refNo || '',
    emailId: emailId,
    linkQuery: opts.linkQuery,
    linkLabel: opts.linkLabel
  });

  let to = [].concat(opts.to || []).filter(String);
  let cc = [].concat(opts.cc || []).filter(String);
  if (isTest) {
    to = [opts.testRedirectTo].filter(String);
    cc = [];
  }

  const record = {
    EmailID: emailId,
    SentAt: nowIso_(),
    TemplateCode: template.code,
    TemplateVersion: template.version,
    To: to.join(', '),
    Cc: cc.join(', '),
    Subject: subject,
    BodySnapshot: bodyText,
    ClaimIDs: (opts.claimIds || []).join(', '),
    RefNo: opts.refNo || '',
    Status: 'Sent',
    Error: '',
    IsTest: isTest
  };

  if (!to.length) {
    record.Status = 'Failed';
    record.Error = 'No recipient address';
    insert_(SHEET.EMAIL_LOG, record);
    return record;
  }

  try {
    MailApp.sendEmail({
      to: to.join(','),
      cc: cc.length ? cc.join(',') : undefined,
      subject: subject,
      htmlBody: html,
      body: bodyText,
      name: 'Warranty Claim Portal'
    });
  } catch (e) {
    record.Status = 'Failed';
    record.Error = String(e.message || e);
  }
  insert_(SHEET.EMAIL_LOG, record);
  return record;
}

function adminEmails_() {
  return readAll_(SHEET.USERS)
    .filter(function (u) { return u.Role === ROLE.ADMIN && isTrue_(u.Active); })
    .map(function (u) { return u.Email; });
}

/**
 * Recipients for one principal. The portal serves several, so a digest is never
 * addressed to "the principals" — only to the accounts belonging to the
 * principal whose units the batch contains.
 */
function principalEmails_(principal) {
  const wanted = String(principal || '').trim();
  return readAll_(SHEET.USERS)
    .filter(function (u) {
      return u.Role === ROLE.PRINCIPAL && isTrue_(u.Active) &&
        String(u.Principal || '').trim() === wanted;
    })
    .map(function (u) { return u.Email; });
}

/* ------------------------------------------------- template administration */

function listTemplates_(session) {
  requireRole_(session, [ROLE.ADMIN]);
  return DEFAULT_TEMPLATES.map(function (d) {
    const loaded = loadTemplate_(d.code);
    const stored = findBy_(SHEET.TEMPLATES, 'TemplateCode', d.code);
    return {
      code: d.code,
      name: loaded.name,
      subject: loaded.subject,
      body: loaded.body,
      version: loaded.version,
      isDefault: loaded.isDefault,
      required: d.required,
      updatedBy: stored ? stored.UpdatedBy : '',
      updatedAt: stored ? stored.UpdatedAt : ''
    };
  });
}

function saveTemplate_(session, payload) {
  requireRole_(session, [ROLE.ADMIN]);
  const code = payload.code;
  if (!defaultTemplate_(code)) throw new Error('Unknown template ' + code);

  const missing = missingPlaceholders_(code, String(payload.subject) + '\n' + String(payload.body));
  if (missing.length) {
    throw new Error('These placeholders are required for the audit record and must stay in the ' +
      'template: ' + missing.join(', '));
  }

  return withLock_(function () {
    const existing = findBy_(SHEET.TEMPLATES, 'TemplateCode', code);
    const version = existing ? Number(existing.Version || 0) + 1 : 1;
    const record = {
      TemplateCode: code,
      Name: payload.name || defaultTemplate_(code).name,
      Subject: payload.subject,
      Body: payload.body,
      Version: version,
      Active: true,
      UpdatedBy: session.email,
      UpdatedAt: nowIso_()
    };
    if (existing) update_(SHEET.TEMPLATES, 'TemplateCode', code, record);
    else insert_(SHEET.TEMPLATES, record);

    audit_(session, 'TemplateChange', {
      field: code, oldValue: existing ? 'v' + existing.Version : 'default',
      newValue: 'v' + version
    });
    return loadTemplate_(code);
  });
}

function restoreTemplate_(session, code) {
  requireRole_(session, [ROLE.ADMIN]);
  return withLock_(function () {
    const existing = findBy_(SHEET.TEMPLATES, 'TemplateCode', code);
    if (existing) update_(SHEET.TEMPLATES, 'TemplateCode', code, { Active: false });
    audit_(session, 'TemplateChange', { field: code, oldValue: 'custom', newValue: 'default' });
    return loadTemplate_(code);
  });
}

/** Sends the selected template to the administrator using sample data. */
function sendTestTemplate_(session, code) {
  requireRole_(session, [ROLE.ADMIN]);
  const sample = {
    ClaimID: 'CLM-260830-0004', RefNo: 'CW300826', Customer: 'RSUD Koja',
    Principal: 'Sansin', SerialNumber: 'XT2410090',
    WarrantyBasis: 'assembled Oct 2024 + 22 months = valid until Aug 2026',
    WorkOrder: 'WO-2608-0041', Problem: 'Machine does not power on',
    RequesterName: 'Rian Pratama', SubmittedAt: '30 Aug 2026 14:25',
    VerifiedBy: session.email, ClaimCount: 1, PartCount: 2,
    ApprovedCount: 1, RejectedCount: 1,
    DecisionBy: 'roland@westley.com', DecisionAt: '31 Aug 2026 09:10',
    ForwardedBy: session.email, ForwardedAt: '02 Sep 2026 10:00',
    ReturnReason: 'Fault photo is unclear', AmendedBy: session.email,
    AmendedAt: '30 Aug 2026 16:00', Reason: 'Corrected on request',
    Items: [
      { PartName: 'Electrical Mainboard', Qty: 1, ItemStatus: 'Approved', DecisionReason: '',
        ClaimID: 'CLM-260830-0004', Customer: 'RSUD Koja', SerialNumber: 'XT2410090',
        WorkOrder: 'WO-2608-0041' },
      { PartName: 'Power supply', Qty: 1, ItemStatus: 'Rejected',
        DecisionReason: 'Not covered under warranty', ClaimID: 'CLM-260830-0004',
        Customer: 'RSUD Koja', SerialNumber: 'XT2410090', WorkOrder: 'WO-2608-0041',
        AdvanceIssue: 'already supplied from local stock' }
    ],
    Changes: [{ Field: 'Customer', OldValue: 'RSUD Kojaa', NewValue: 'RSUD Koja' }]
  };
  sample.Claims = [Object.assign({}, sample)];

  return sendMail_({
    code: code, to: [session.email], data: sample, refNo: sample.RefNo,
    claimIds: [sample.ClaimID], isTest: true, testRedirectTo: session.email,
    linkQuery: 'page=claims', linkLabel: 'Open the portal'
  });
}

function listEmailLog_(session, filter) {
  requireRole_(session, [ROLE.ADMIN]);
  const f = filter || {};
  let rows = readAll_(SHEET.EMAIL_LOG);
  if (f.claimId) {
    rows = rows.filter(function (r) { return String(r.ClaimIDs).indexOf(f.claimId) !== -1; });
  }
  rows.sort(function (a, b) { return String(b.SentAt).localeCompare(String(a.SentAt)); });
  return rows.slice(0, f.limit || 100).map(function (r) {
    return {
      emailId: r.EmailID, sentAt: r.SentAt, code: r.TemplateCode,
      version: r.TemplateVersion, to: r.To, cc: r.Cc, subject: r.Subject,
      claimIds: r.ClaimIDs, refNo: r.RefNo, status: r.Status, error: r.Error,
      isTest: isTrue_(r.IsTest), body: r.BodySnapshot
    };
  });
}
