'use strict';

/* ── Error Code Database ───────────────────────────────────────────────────── *
 * Keys: uppercase hex strings like "0x80070005" OR decimal strings like "1603"
 * ─────────────────────────────────────────────────────────────────────────── */
var ERROR_DB = {
  // ── S_OK / Generic HRESULT ────────────────────────────────────────────────
  '0x00000000': 'S_OK – Operation completed successfully',
  '0x80004002': 'E_NOINTERFACE – No such interface supported',
  '0x80004005': 'E_FAIL – Unspecified failure',
  '0x8000FFFF': 'E_UNEXPECTED – Catastrophic failure',

  // ── Win32 errors (0x8007xxxx) ──────────────────────────────────────────────
  '0x80070002': 'ERROR_FILE_NOT_FOUND – The system cannot find the file specified',
  '0x80070003': 'ERROR_PATH_NOT_FOUND – The system cannot find the path specified',
  '0x80070005': 'ERROR_ACCESS_DENIED – Access is denied',
  '0x80070006': 'ERROR_INVALID_HANDLE – The handle is invalid',
  '0x8007000B': 'ERROR_BAD_FORMAT – An attempt was made to load a program with an incorrect format',
  '0x8007000D': 'ERROR_INVALID_DATA – The data is invalid',
  '0x8007000E': 'ERROR_OUTOFMEMORY – Not enough memory resources to complete this operation',
  '0x80070057': 'ERROR_INVALID_PARAMETER – The parameter is incorrect',
  '0x80070070': 'ERROR_DISK_FULL – There is not enough space on the disk',
  '0x8007007B': 'ERROR_INVALID_NAME – The filename, directory name, or volume label syntax is incorrect',
  '0x8007007E': 'ERROR_MOD_NOT_FOUND – The specified module could not be found',
  '0x80070080': 'ERROR_INSUFFICIENT_BUFFER – The data area passed to a system call is too small',
  '0x800700B7': 'ERROR_ALREADY_EXISTS – Cannot create a file when that file already exists',
  '0x80070102': 'WAIT_TIMEOUT – The wait operation timed out',
  '0x80070420': 'ERROR_SERVICE_ALREADY_RUNNING – An instance of the service is already running',
  '0x80070422': 'ERROR_SERVICE_DISABLED – The service cannot be started because it is disabled',
  '0x80070424': 'ERROR_SERVICE_DOES_NOT_EXIST – The specified service does not exist as an installed service',
  '0x80070426': 'ERROR_SERVICE_NOT_ACTIVE – The service has not been started',
  '0x80070490': 'ERROR_NOT_FOUND – Element not found',
  '0x80070520': 'ERROR_NO_SUCH_LOGON_SESSION – A specified logon session does not exist',
  '0x80070570': 'ERROR_FILE_CORRUPT – The file or directory is corrupt and unreadable',
  '0x800704B3': 'ERROR_NETWORK_UNREACHABLE – The network location cannot be reached',
  '0x800704CF': 'ERROR_NETWORK_UNREACHABLE – The remote device or resource won\'t accept the connection',
  '0x800706BA': 'RPC_S_SERVER_UNAVAILABLE – The RPC server is unavailable',
  '0x80070BC2': 'ERROR_SUCCESS_REBOOT_REQUIRED – Reboot required for changes to take effect',
  '0x80070BC9': 'ERROR_FAIL_NOACTION_REBOOT – A reboot is necessary to complete the install',
  '0x8007F0F4': 'STATUS_PATCH_NOT_APPLICABLE – The patch is not applicable to this machine',
  '0x8007139F': 'ERROR_INVALID_STATE – The group or resource is not in the correct state',

  // ── Windows Update (0x8024xxxx) ────────────────────────────────────────────
  '0x80240001': 'WU_E_NO_SERVICE – Windows Update Agent was unable to provide the service',
  '0x80240002': 'WU_E_MAX_CAPACITY_REACHED – Maximum capacity of the service was exceeded',
  '0x80240016': 'WU_E_INSTALL_NOT_ALLOWED – Another installation was already in progress',
  '0x80240017': 'WU_E_NOT_APPLICABLE – Operation was not performed because no applicable updates',
  '0x8024001E': 'WU_E_SERVICE_STOP – Operation did not complete because service was being shut down',
  '0x80240020': 'WU_E_NO_INTERACTIVE_USER – No logged-on interactive user to notify',
  '0x80240022': 'WU_E_ALL_UPDATES_FAILED – Operation failed for all the updates',
  '0x80240026': 'WU_E_INVALID_UPDATE_TYPE – The type of update is invalid',
  '0x80240034': 'WU_E_DOWNLOAD_FAILED – Update failed to download',
  '0x80244010': 'WU_E_PT_EXCEEDED_MAX_SERVER_TRIPS – The number of round trips to the server exceeded the maximum limit',
  '0x80244016': 'WU_E_PT_HTTP_STATUS_BAD_REQUEST – HTTP 400 Bad Request',
  '0x80244019': 'WU_E_PT_HTTP_STATUS_NOT_FOUND – HTTP 404 Not Found',
  '0x80244021': 'WU_E_PT_HTTP_STATUS_BAD_GATEWAY – HTTP 503 Service Unavailable',
  '0x80246008': 'WU_E_DM_FAILTOCONNECTTOBITS – Could not connect to BITS',
  '0x8024402F': 'WU_E_PT_ECP_SUCCEEDED_WITH_ERRORS – External cab file processing completed with errors',
  '0x80245001': 'WU_E_REDIRECTOR_LOAD_XML – The redirector XML document could not be loaded',

  // ── BITS (0x801Bxxxx / 0x8019xxxx) ────────────────────────────────────────
  '0x80190190': 'BG_E_HTTP_ERROR_400 – HTTP 400 Bad Request',
  '0x80190193': 'BG_E_HTTP_ERROR_403 – HTTP 403 Forbidden – insufficient access rights',
  '0x80190194': 'BG_E_HTTP_ERROR_404 – HTTP 404 Not Found',
  '0x80190197': 'BG_E_HTTP_ERROR_407 – HTTP 407 Proxy Authentication Required',
  '0x801901F4': 'BG_E_HTTP_ERROR_500 – HTTP 500 Internal Server Error',
  '0x801901F7': 'BG_E_HTTP_ERROR_503 – HTTP 503 Service Unavailable',

  // ── Delivery Optimization ─────────────────────────────────────────────────
  '0x80D02002': 'DO_E_DOWNLOAD_NO_URI – No URI provided for the download',
  '0x80D0200C': 'DO_E_NO_FOREGROUND_DOWNLOAD_TIMEOUT – Foreground download timeout not set',
  '0x80D02013': 'DO_E_BLOCKED_BY_POLICY – Delivery Optimization blocked by policy',
  '0x80D02017': 'DO_E_UNKNOWN_PROPERTY_ID – Unknown property ID',

  // ── Certificate / Crypto ──────────────────────────────────────────────────
  '0x80090010': 'NTE_PERM – Access denied (cryptographic operation)',
  '0x80090016': 'NTE_BAD_KEYSET – Key set does not exist',
  '0x80090026': 'NTE_FAIL – Cryptographic function failed',
  '0x800B0100': 'TRUST_E_NOSIGNATURE – No signature was present in the subject',
  '0x800B0101': 'CERT_E_EXPIRED – A required certificate is not within its validity period',
  '0x800B0109': 'CERT_E_UNTRUSTEDROOT – Certificate chain terminated in an untrusted root certificate',
  '0x800B010F': 'CERT_E_CN_NO_MATCH – The certificate CN does not match the passed value',
  '0x800B0110': 'CERT_E_WRONG_USAGE – The certificate is not valid for the requested usage',

  // ── Azure AD / Entra ──────────────────────────────────────────────────────
  '0xCAA20001': 'AAD_E_INVALID_URL – The URL is not valid for this operation',
  '0xCAA20002': 'AAD_E_SERVICE_FAILURE – The Azure AD service returned an error',
  '0xCAA2000C': 'AAD_E_INVALID_AUDIENCE – Token issued for a different audience',
  '0xCAA90004': 'AAD_E_HTTP_FAILURE – HTTP request to Azure AD failed',
  '0xCAA5001C': 'AAD_E_DEVICE_AUTHENTICATION_FAILED – Device authentication failed',
  '0xCAA50024': 'AAD_E_OAUTH_FAILED – OAuth token request failed',

  // ── MDM Enrollment ────────────────────────────────────────────────────────
  '0x80180001': 'MDM_E_ENROLLMENT_CANCELLED – MDM enrollment was cancelled',
  '0x80180002': 'MDM_E_DEVICE_ALREADY_ENROLLED – The device is already enrolled',
  '0x80180003': 'MDM_E_POLICY_CONFIGURATION_FAILURE – Policy configuration failed',
  '0x80180004': 'MDM_E_ENROLLMENT_SERVER_ERROR – Enrollment server returned an error',
  '0x80190001': 'MDM_E_HTTP_ERROR – HTTP error during MDM enrollment',

  // ── SCCM / ConfigMgr ──────────────────────────────────────────────────────
  '0x87D00215': 'SCCM_E_WMI_NOT_FOUND – WMI not found or connection failed',
  '0x87D00607': 'SCCM_E_INSTALL_FAILED – Application installation failed',
  '0x87D00708': 'SCCM_E_PREREQ_NOT_MET – Prerequisites not met',
  '0x87D00777': 'SCCM_E_REQUIREMENT_NOT_MET – Application requirement not met',
  '0x87D01106': 'SCCM_E_DOWNLOAD_FAILED – Content download failed',
  '0x87D012FF': 'SCCM_E_UNKNOWN – Unknown SCCM error',

  // ── Intune ─────────────────────────────────────────────────────────────────
  '0x87D1041C': 'INTUNE_E_TIMEOUT – The Intune operation timed out',
  '0x87D1313C': 'INTUNE_E_UNEXPECTED_ERROR – An unexpected error occurred',
  '0x87D10D4C': 'INTUNE_E_APP_INSTALL_FAILED – Application installation failed via Intune',
  '0x87D13B63': 'INTUNE_E_APP_REQUIRED_INSTALL_PENDING – App required install is pending reboot',
  '0x87D20001': 'INTUNE_E_CHECK_IN_FAILED – Device check-in failed',

  // ── MSI / Installer (decimal) ──────────────────────────────────────────────
  '1601': 'MSI 1601 – The Windows Installer service could not be accessed',
  '1602': 'MSI 1602 – User cancelled the installation',
  '1603': 'MSI 1603 – A fatal error occurred during installation',
  '1604': 'MSI 1604 – Installation suspended; incomplete',
  '1605': 'MSI 1605 – This action is only valid for currently installed products',
  '1606': 'MSI 1606 – Feature ID not registered',
  '1618': 'MSI 1618 – Another installation is already in progress',
  '1619': 'MSI 1619 – This installation package could not be opened',
  '1620': 'MSI 1620 – This installation package could not be opened (invalid package)',
  '1622': 'MSI 1622 – Error opening installation log file',
  '1623': 'MSI 1623 – This language of this installation package is not supported',
  '1625': 'MSI 1625 – This installation is forbidden by system policy',
  '1633': 'MSI 1633 – This installation package is not supported on this processor type',
  '1638': 'MSI 1638 – Another version of this product is already installed',
  '1641': 'MSI 1641 – The installer has initiated a restart (success)',
  '1642': 'MSI 1642 – The installer cannot install the upgrade patch',
  '3010': 'MSI 3010 – A restart is required to complete the install (success with reboot)',

  // ── WinGet ────────────────────────────────────────────────────────────────
  '0x8A150001': 'WINGET_E_MANIFEST_FAILED – Manifest validation failed',
  '0x8A150002': 'WINGET_E_INSTALLER_FAILED – Installer execution failed',
  '0x8A150019': 'WINGET_E_NO_APPLICABLE_INSTALLER – No applicable installer found for this system',
  '0x8A15001A': 'WINGET_E_INSTALLER_HASH_MISMATCH – Installer hash does not match',
  '0x8A15003B': 'WINGET_E_BLOCKED_BY_POLICY – WinGet blocked by Group Policy',
};

// Lookup by hex string (with or without 0x prefix) or decimal string
function lookupErrorCode(input) {
  if (!input) return null;
  var s = String(input).trim();

  // Try direct hex lookup (normalize to uppercase 0x...)
  var hexNorm;
  if (/^0x/i.test(s)) {
    hexNorm = '0x' + s.slice(2).toUpperCase().padStart(8, '0').slice(-8);
  } else if (/^[0-9A-Fa-f]{4,8}$/.test(s)) {
    hexNorm = '0x' + s.toUpperCase().padStart(8, '0').slice(-8);
  }
  if (hexNorm && ERROR_DB[hexNorm]) return ERROR_DB[hexNorm];
  if (hexNorm && ERROR_DB[hexNorm.toLowerCase()]) return ERROR_DB[hexNorm.toLowerCase()];

  // Try decimal → signed 32-bit → hex
  var dec = parseInt(s, 10);
  if (!isNaN(dec)) {
    // Negative decimal (signed 32-bit)
    var u32 = dec >>> 0; // to unsigned 32-bit
    var hexFromDec = '0x' + u32.toString(16).toUpperCase().padStart(8, '0');
    if (ERROR_DB[hexFromDec]) return ERROR_DB[hexFromDec];
    // Try decimal key directly (MSI codes)
    if (ERROR_DB[String(dec)]) return ERROR_DB[String(dec)];
  }

  return null;
}

// Extract all error codes mentioned in a string and look them up
function findErrorCodesInText(text) {
  if (!text) return [];
  var results = [];
  var seen = new Set();

  var hexRe = /0x[0-9A-Fa-f]{4,8}/gi;
  var m;
  while ((m = hexRe.exec(text)) !== null) {
    var code = m[0];
    if (seen.has(code.toLowerCase())) continue;
    seen.add(code.toLowerCase());
    var desc = lookupErrorCode(code);
    if (desc) results.push({ code: code, description: desc });
  }

  // MSI decimal codes
  var decRe = /\b(1[56]\d{2}|1[0-4]\d{2}|30[01]\d)\b/g;
  while ((m = decRe.exec(text)) !== null) {
    var code = m[0];
    if (seen.has(code)) continue;
    seen.add(code);
    var desc = lookupErrorCode(code);
    if (desc) results.push({ code: code, description: desc });
  }

  return results;
}
