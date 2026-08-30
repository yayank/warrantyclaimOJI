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
  POPULATION: 'Population'
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
  'CreatedAt', 'SubmittedAt', 'ForwardedAt', 'PrincipalNotifiedAt', 'ClosedAt',
  'ReturnReason', 'DriveFolderId',
  'Deleted', 'DeletedBy', 'DeletedAt',
  'UpdatedAt', 'UpdatedBy', 'RowVersion'
];

SCHEMA[SHEET.ITEMS] = [
  'ItemID', 'ClaimID', 'PartID', 'PartName', 'Qty', 'ItemStatus',
  'AdvanceIssued', 'AdvanceIssuedAt', 'AdvanceIssuedBy', 'AdvanceNote',
  'DecisionBy', 'DecisionAt', 'DecisionReason',
  'AvailabilityDate', 'DocumentRefNo',
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

SCHEMA[SHEET.USERS] = ['Email', 'Name', 'Role', 'Principal', 'Active', 'CreatedAt'];
SCHEMA[SHEET.CUSTOMER] = ['CustomerID', 'Name', 'Active'];
SCHEMA[SHEET.PART] = ['PartID', 'Name', 'Active'];
SCHEMA[SHEET.RECIPIENTS] = ['RecipientID', 'Name', 'Email', 'Company', 'Principal', 'Active', 'Notes'];
SCHEMA[SHEET.PRINCIPALS] = ['PrincipalID', 'Name', 'Active', 'Notes'];
SCHEMA[SHEET.SETTINGS] = ['Key', 'Value'];
SCHEMA[SHEET.WARRANTY] = ['SellingInDate', 'Material', 'Batch', 'Status', 'exp', 'Expired'];
SCHEMA[SHEET.POPULATION] = [
  'Delivery', 'SellingInDate', 'Material', 'ItemDescription', 'Batch',
  'DeliveryQuantity', 'ShipToParty', 'Principal'
];

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

const WARRANTY_TYPE = {
  PRINCIPAL: 'Principal Warranty',
  OUT: 'Out of Principal Warranty',
  MANUAL: 'Manual Verification Required',
  INTERNAL: 'Internal Warranty'
};

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
  APP_URL: 'AppUrl'
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
