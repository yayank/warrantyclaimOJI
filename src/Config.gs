/**
 * Config.gs — sheet schema, enumerations and constants.
 *
 * Every sheet the application owns is declared here. Repo.ensureSheets() creates
 * anything missing on first run, so a fresh spreadsheet needs no manual setup.
 */

const TZ = 'Asia/Jakarta';

const SHEET = {
  CLAIMS: 'Claims',
  ITEMS: 'ClaimItems',
  ATTACHMENTS: 'Attachments',
  AUDIT: 'AuditLog',
  EMAIL_LOG: 'EmailLog',
  TEMPLATES: 'EmailTemplates',
  USERS: 'users',
  CUSTOMER: 'Customer',
  PART: 'sparepart',
  RECIPIENTS: 'Recipients',
  PRINCIPALS: 'Principals',
  SETTINGS: 'Settings',
  WARRANTY: 'warranty',
  POPULATION: 'Population',
  PRODUCTS: 'Products',
  RULES: 'WarrantyRules',
  DISTRIBUTORS: 'Distributors',
  UNIT_REQUESTS: 'UnitRequests'
};

const SCHEMA = {};

SCHEMA[SHEET.CLAIMS] = [
  'ClaimID', 'RefNo', 'IsTest',
  'CustomerID', 'CustomerName',
  'SerialNumber', 'ProductName', 'AssemblyMonth', 'Principal',
  'WarrantyType', 'WarrantyExpiry', 'WarrantyBasis',
  'WarrantyOverridden', 'WarrantyOverrideReason',
  'ProblemDescription', 'WorkOrderNo', 'Status',
  'RequesterEmail', 'RequesterName',

  // Which distributor raised it, taken from the account that filed it — not
  // from the unit. DistributorID above says who sold the machine; this says on
  // whose behalf the claim was made, and only this one may decide who sees it.
  // The two differ exactly when our own field service claims on a machine a
  // distributor sold, which is the case that would otherwise leak.
  'RequesterDistributorID',
  'CreatedAt', 'SubmittedAt', 'ForwardedAt', 'PrincipalNotifiedAt', 'ClosedAt',
  'ReturnReason', 'DriveFolderId',

  // The other tier, photographed when the claim was filed.
  //
  // WarrantyType above still means the principal side and nothing else: it is
  // what decides whether an order is forwarded, what a principal is allowed to
  // see, and which tab a claim falls in. These say what we still owe whoever
  // bought the unit, which is a different question with a different answer.
  //
  // CostBorne is the quadrant the board asks about: the principal has stopped
  // covering it and we have not. Stored rather than worked out on read, for the
  // same reason as the summary columns below — otherwise the report would
  // resolve two warranties per row.
  'DistributorID', 'DistributorName',
  'CustomerWarrantyType', 'CustomerWarrantyExpiry', 'CustomerWarrantyBasis',
  'CostBorne', 'WarrantySnapshotAt',

  // Counted from ClaimItems and written back here whenever an item changes.
  // The claim list reads these instead of the items, which is what lets it
  // answer without reading the item sheet at all. Nothing else may write them:
  // they are a copy of the truth, and the only safe copy is one with a single
  // author. See summaryOf_ and refreshClaimSummaries_ in Claims.gs.
  'ItemCount',
  'PendingCount', 'ApprovedCount', 'RejectedCount',
  'ShippedCount', 'AwaitingReturnCount', 'AdvanceCount', 'AdvanceQueueCount',

  'Deleted', 'DeletedBy', 'DeletedAt',
  'UpdatedAt', 'UpdatedBy', 'RowVersion'
];

SCHEMA[SHEET.ITEMS] = [
  'ItemID', 'ClaimID', 'PartID', 'PartName', 'Qty', 'ItemStatus',
  'AdvanceIssued', 'AdvanceIssuedAt', 'AdvanceIssuedBy', 'AdvanceNote',
  'DecisionBy', 'DecisionAt', 'DecisionReason',
  'AvailabilityDate', 'DocumentRefNo', 'FulfilmentRoute',
  'ForwardedAt', 'ForwardedTo',
  'ShippedAt', 'ShippedBy',
  'PartReturnNote', 'PartReturnAt',
  'Deleted', 'UpdatedAt', 'UpdatedBy', 'RowVersion'
];

SCHEMA[SHEET.ATTACHMENTS] = [
  'AttachmentID', 'ClaimID', 'ItemID', 'Kind', 'DriveFileId',
  'FileName', 'OriginalFileName', 'MimeType', 'SizeBytes',
  'Version', 'Superseded', 'UploadedBy', 'UploadedAt'
];

SCHEMA[SHEET.AUDIT] = [
  'LogID', 'Timestamp', 'Actor', 'ActorRole', 'SimulatedRole',
  'ClaimID', 'ItemID', 'Action', 'Field', 'OldValue', 'NewValue', 'Reason', 'IsTest'
];

SCHEMA[SHEET.EMAIL_LOG] = [
  'EmailID', 'SentAt', 'TemplateCode', 'TemplateVersion',
  'To', 'Cc', 'Subject', 'BodySnapshot', 'ClaimIDs', 'RefNo',
  'Status', 'Error', 'IsTest'
];

SCHEMA[SHEET.TEMPLATES] = [
  'TemplateCode', 'Name', 'Subject', 'Body', 'Version', 'Active', 'UpdatedBy', 'UpdatedAt'
];

SCHEMA[SHEET.USERS] = ['Email', 'Name', 'Role', 'Principal', 'Distributor', 'Active', 'CreatedAt'];
SCHEMA[SHEET.CUSTOMER] = ['CustomerID', 'Name', 'Active'];
SCHEMA[SHEET.PART] = ['PartID', 'Name', 'Active'];
SCHEMA[SHEET.RECIPIENTS] = ['RecipientID', 'Name', 'Email', 'Company', 'Principal', 'Active', 'Notes'];
SCHEMA[SHEET.PRINCIPALS] = ['PrincipalID', 'Name', 'Active', 'Notes'];
SCHEMA[SHEET.SETTINGS] = ['Key', 'Value'];
SCHEMA[SHEET.WARRANTY] = ['SellingInDate', 'Material', 'Batch', 'Status', 'exp', 'Expired'];
SCHEMA[SHEET.POPULATION] = [
  'Delivery', 'SellingInDate', 'Material', 'ItemDescription', 'Batch',
  'DeliveryQuantity', 'ShipToParty', 'Principal',

  // Filled in by an administrator or by an import. Which of these a unit needs
  // depends on what its model's warranty rule counts from: a rule reading the
  // installation date is answered by InstalledAt and by nothing else.
  'Channel', 'DistributorID', 'CustomerID',
  'ReceivedAtDistributor', 'InstalledAt',
  'ExtendedMonthsPrincipal', 'ExtendedMonthsCustomer',
  'ContractRef', 'WarrantyNote',

  // Worked out from the columns above and the rules sheet, then written back
  // here. Nothing else may write them and nobody should edit them by hand:
  // they are recomputed from source every time, never adjusted. See
  // unitWarrantyOf_ and recomputeUnitWarranty_ in Units.gs.
  //
  // Dates, never a status. "Still under warranty" is a different answer
  // tomorrow morning, so what is stored is when cover ends and the verdict is
  // worked out when somebody asks.
  'AssemblyMonth',
  'WarrantyStartPrincipal', 'WarrantyEndPrincipal', 'WarrantyBasisPrincipal',
  'WarrantyStartCustomer', 'WarrantyEndCustomer', 'WarrantyBasisCustomer',
  'WarrantyComputedAt'
];

/**
 * One row per product model. Material is the key, and it is one value per
 * model — confirmed with the owner before this was built, because the whole
 * rule lookup hangs off it.
 */
SCHEMA[SHEET.PRODUCTS] = [
  'Material', 'Name', 'Principal', 'Regulation', 'SerialPattern', 'Active', 'Notes'
];

/**
 * The warranty terms themselves, as data rather than as a constant.
 *
 * One row is one side of one model on one sales channel. Scope separates the
 * two tiers: what the principal still covers for us, and what we still cover
 * for whoever bought it. EffectiveFrom/To are matched against the unit's own
 * basis date, never against today — a policy changed this year must not
 * shorten the warranty of a unit sold three years ago.
 */
SCHEMA[SHEET.RULES] = [
  'RuleID', 'Material', 'Scope', 'Channel', 'Basis', 'Months',
  'EffectiveFrom', 'EffectiveTo', 'Active', 'Notes'
];

SCHEMA[SHEET.DISTRIBUTORS] = ['DistributorID', 'Name', 'Email', 'Active', 'Notes'];

/**
 * A unit somebody found in a hospital that the register has never heard of.
 *
 * The portal refuses to file a claim on it, because there is a separate system
 * of record for installations that has to be updated first and because a
 * distributor who can claim on an unreported unit never reports one. But the
 * engineer standing in front of the broken machine has already typed the fault
 * and photographed the part, and none of that may be thrown away — so the claim
 * waits as a draft and this row is what gets the unit registered.
 */
SCHEMA[SHEET.UNIT_REQUESTS] = [
  'RequestID', 'SerialNumber', 'ProductGuess',
  'CustomerID', 'CustomerName', 'DistributorID',
  'Note', 'DriveFolderId', 'ClaimID', 'Status',
  'RequestedBy', 'RequestedByName', 'RequestedAt',
  'HandledBy', 'HandledAt', 'Outcome'
];

const UNIT_REQUEST_STATUS = {
  OPEN: 'Open',
  REGISTERED: 'Registered',
  REJECTED: 'Rejected'
};

/**
 * Sheets that arrive from the old workbook as a bare list with no header row.
 *
 * The customer and spare-part lists are a single column of names: row 1 is a
 * real customer, not a column name. Read as a header it disappears and every
 * Name reads blank, which empties the dropdowns. This names the schema field
 * each unlabelled column actually holds, in order, so the values can be moved
 * under the declared header instead of being mistaken for one.
 */
const ADOPT = {};
ADOPT[SHEET.CUSTOMER] = ['Name'];
ADOPT[SHEET.PART] = ['Name'];

/** Roles. */
const ROLE = {
  REQUESTER: 'Requester',
  PRODUCTION: 'Production',
  ADMIN: 'Administrator',
  PRINCIPAL: 'Principal',
  TESTER: 'Tester'
};

/** Claim-level workflow position. Decisions live on the items. */
const STATUS = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  RETURNED: 'Returned to Requester',
  IN_REVIEW: 'In Review',
  INTERNAL: 'Internal Verification',
  FULFILMENT: 'In Fulfilment',
  CLOSED: 'Closed'
};

const ITEM_STATUS = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  FORWARDED: 'Order Forwarded',
  AWAITING: 'Awaiting Part Availability',
  SHIPPED: 'Shipped'
};

/**
 * How an approved part is going to be obtained.
 *
 * A claim still under principal warranty is ordered from the principal, and
 * that is the only route that involves them. Once a unit is out of their
 * warranty the part has to come from somewhere else: raised as a purchase
 * request, or taken off the shelf. Blank until an administrator decides.
 */
const FULFILMENT = {
  PRINCIPAL: 'Principal order',
  PR: 'Purchase request',
  STOCK: 'From stock'
};

const WARRANTY_TYPE = {
  PRINCIPAL: 'Principal Warranty',
  OUT: 'Out of Principal Warranty',
  MANUAL: 'Manual Verification Required',
  INTERNAL: 'Internal Warranty'
};

/**
 * The other tier: what we still owe whoever bought the unit, which is not the
 * same question as what the principal still owes us and frequently has a
 * different answer. Manual reads the same on both sides on purpose, so one
 * filter finds everything waiting on a person.
 */
const CUSTOMER_WARRANTY_TYPE = {
  IN: 'Under Our Warranty',
  OUT: 'Out of Our Warranty',
  MANUAL: WARRANTY_TYPE.MANUAL
};

/** Which of the two tiers a rule or a verdict is about. */
const WARRANTY_SCOPE = { PRINCIPAL: 'principal', CUSTOMER: 'customer' };

/** How the unit reached the hospital. '*' on a rule means either way. */
const SALES_CHANNEL = { DIRECT: 'direct', DISTRIBUTOR: 'distributor', ANY: '*' };

/**
 * What the months are counted from. All four are in use across the portfolio
 * because each principal writes its own policy; which one applies is decided
 * by the product, not by who sold it.
 */
const WARRANTY_BASIS = {
  ASSEMBLY: 'assembly',
  SELLING_IN: 'selling-in',
  RECEIVED: 'received',
  INSTALLATION: 'installation'
};

/**
 * How many claims cross to the browser at once, and the most a caller may ask
 * for. The screen loads more on request rather than drawing a thousand rows
 * nobody scrolls to.
 */
/**
 * The largest attachment the portal will store, applied to what is actually
 * uploaded rather than to the file on disk: photographs are resized in the
 * browser first, so a 12MB snapshot from a phone arrives well under this.
 */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const CLAIM_PAGE = 50;
const CLAIM_PAGE_MAX = 200;

const ATTACHMENT_KIND = { PART: 'PART', FAULT: 'FAULT', REPORT: 'REPORT' };

/** Sansin machines carry a 22 month principal warranty from the assembly month. */
const XT_WARRANTY_MONTHS = 22;

/**
 * The principal a unit belongs to when the population sheet does not say.
 * The portal serves several principals; a claim that cannot be attributed to
 * one is routed to nobody until an administrator resolves it.
 */
const UNASSIGNED_PRINCIPAL = '';

/** The customer every Production claim is pinned to. */
const PRODUCTION_CUSTOMER = 'Internal — Production';

const SETTING_KEY = {
  CLIENT_ID: 'GoogleClientId',
  ROOT_FOLDER: 'DriveRootFolderId',
  DIGEST_HOUR: 'DigestHour',
  APP_URL: 'AppUrl',
  /** Whether the portal sends email at all. Everything is still logged. */
  EMAIL_ENABLED: 'EmailNotifications'
};

const FOLDER = {
  ROOT: 'Klaim',
  TEST: '_UJI',
  DRAFT: '_DRAFT',
  EXPORT: '_EXPORT',
  BACKUP: '_BACKUP',
  PART: '01-PART',
  FAULT: '02-FAULT',
  REPORT: '03-REPORT'
};

const KIND_FOLDER = {};
KIND_FOLDER[ATTACHMENT_KIND.PART] = FOLDER.PART;
KIND_FOLDER[ATTACHMENT_KIND.FAULT] = FOLDER.FAULT;
KIND_FOLDER[ATTACHMENT_KIND.REPORT] = FOLDER.REPORT;

/** Exported files older than this are removed by the daily cleanup trigger. */
const EXPORT_RETENTION_DAYS = 7;
