/**
 * Rule catalog + manual items from PLAN.md §5.6 / §6.1.
 * TODO(T3): this moves to the API seed; the web will fetch it from GET /api/v1/policies.
 */
import { Rule, ManualItem, type Rule as RuleT, type ManualItem as ManualItemT } from '@umd/contracts';

type Def = [id: string, name: string, stage: RuleT['stage'], severity: RuleT['severity'], hint?: string, fix?: string];

const DEFS: Def[] = [
  // S1 image
  ['img.buildstats', 'Imaging finished (buildstats green)', 'image', 'critical', 'Red build → re-image the device.'],
  ['hw.identity', 'Asset tag set (QJ0681xxxx)', 'image', 'critical', 'Run Panasonic PC Asset Tag Entry.'],
  ['acct.mechanic', 'Mechanic account enabled', 'image', 'critical', 'Reset the Mechanic password per checklist.'],
  ['os.build', 'OS build matches target', 'image', 'critical'],
  ['os.patch', 'Cumulative update applied', 'image', 'critical'],
  ['gpo.applied', 'Computer GPOs applied', 'image', 'warn'],
  ['app.intel-gcc', 'Intel Graphics Command Center installed', 'image', 'critical', 'Install via Company Portal → ask the Managed By owner → re-image.'],
  ['app.required-set', 'Required apps installed', 'image', 'critical'],
  ['ui.desktop-icons', '24 desktop icons present', 'image', 'critical', 'SCCM delivery problem — escalate.'],
  ['ui.wallpaper', 'AA desktop background', 'image', 'warn', 'Reboot twice first, then run the fix.', 'wallpaper-restore'],
  // S2 config
  ['tbx.files-current', 'Toolbox Remote 787 files current', 'config', 'critical', 'SCCM not delivering — escalate to SCCM owner.'],
  ['tbx.shortcuts', '787 MCDF + Toolbox Remote (ML) shortcuts', 'config', 'critical'],
  ['tbx.launch', 'Toolbox Remote (ML) launches', 'config', 'warn', 'Open it once and confirm, then attest.'],
  ['ui.display', 'Display 1920×1080, scale Stretched', 'config', 'warn', 'Intel GCC → Display → Scale → Stretched; then 1920×1080.'],
  ['ff.acrobat-plugin', 'Firefox opens PDFs with Adobe Acrobat', 'config', 'critical', 'Close Firefox, then run the fix.', 'ff-acrobat-prefs'],
  ['ff.startup-popups', 'Firefox startup popups disabled', 'config', 'warn', undefined, 'ff-disable-startup'],
  ['lsapl.connections', 'LSAPL connections.properties correct', 'config', 'critical', '"LSAPL is not a location" error.', 'lsapl-restore-file'],
  ['lsapl.truststore', 'LSAPL trust store (.jks) present', 'config', 'critical', '"Missing JKS file" error.', 'lsapl-restore-file'],
  ['lsapl.app-props', 'LSAPL application.properties credentials', 'config', 'critical', '"Check tools>log for details" error.', 'lsapl-patch-props'],
  ['lsapl.airwall-icon', 'Airwall icon removed from desktop', 'config', 'warn', undefined, 'delete-shortcut'],
  ['lsapl.airwall-agent', 'Airwall Agent running', 'config', 'warn', 'Request the QJ be added to Airwall.'],
  ['lsapl.backend', 'LSAPL backend reachable', 'config', 'critical', 'Airwall enrollment missing, or ground network down.'],
  ['lsapl.log', 'No known LSAPL log errors', 'config', 'warn'],
  ['umd.conformance', 'UMD Tools conformance', 'config', 'critical', 'Open UMD Tools → Check Conformance.'],
  ['sccm.pkg-12650', 'Sign-out fix (pkg 12650) installed', 'config', 'warn', 'Re-running signs the user out.', 'sccm-rerun-12650'],
  ['net.ground', 'Ground network reachable', 'config', 'critical'],
  // S3 hardware
  ['cell.sim-ready', 'SIM inserted and ready', 'hardware', 'critical', 'Reseat the SIM and screw the cap back on.'],
  ['cell.data-slot', 'SIM 1 used for data', 'hardware', 'warn', 'Cellular settings → Use this SIM for cellular data.'],
  ['cell.apn', 'APN AA FirstNet / 32871.fn', 'hardware', 'critical', 'Mobile operator settings → Add APN.'],
  ['cell.myboeingfleet', 'myboeingfleet.com reachable over cellular', 'hardware', 'critical'],
  ['disk.data.present', '4 TB drive detected', 'hardware', 'critical', 'Power off, reseat the caddy, confirm it is the 4 TB unit.'],
  ['disk.data.seated', '4 TB drive seated (no I/O errors)', 'hardware', 'warn', 'Loose or damaged seating — reseat.'],
  ['disk.data.health', '4 TB drive healthy', 'hardware', 'critical', 'Replace the drive.'],
  ['disk.data.unconfigured', '4 TB drive left unconfigured (RAW)', 'hardware', 'critical', 'Must stay unconfigured. No auto-fix — the agent never wipes disks.'],
  ['disk.old-removed', 'Old drive removed', 'hardware', 'warn', 'The old drive may still be installed.'],
  ['disk.os-health', 'OS disk healthy, ≥ 20 GB free', 'hardware', 'warn'],
  // S4 bios
  ['bios.version', 'BIOS version current (for variant)', 'bios', 'critical', 'Run the BIOS package for this variant. Touch package fails on non-touch units.'],
  ['bios.secureboot', 'Secure Boot enabled', 'bios', 'critical', 'Security → Secure Boot Control → Enabled.'],
  ['bios.bluetooth-off', 'Bluetooth disabled in BIOS', 'bios', 'warn', 'Advanced → Wireless → Bluetooth Disabled.'],
  ['bios.touch-off', 'Touchscreen disabled in BIOS', 'bios', 'warn', 'Advanced → Touchscreen Disabled.'],
  ['bios.boot-order', 'Boot order set, no LAN boot', 'bios', 'warn', 'Boot → UEFI Boot from LAN Disabled; set Boot Option #1.'],
  ['bios.settings', 'Other BIOS settings', 'bios', 'warn', 'Power On AC, Concealed Mode, Password on Boot, supervisor password.'],
];

export const RULES: RuleT[] = DEFS.map(([id, name, stage, severity, hint, fix]) =>
  Rule.parse({ id, name, stage, severity, type: 'mock', hint, remediation: fix ? { scriptId: fix } : undefined }),
);

export const MANUAL_ITEMS: ManualItemT[] = (
  [
    ['man.bes', 'image', "Device is BES'd"],
    ['man.oobe', 'image', 'OOBE temp setup done'],
    ['man.qj-label', 'image', 'QJ label applied'],
    ['man.bios-preimage', 'image', 'BIOS pre-image settings entered'],
    ['man.mcdf-opens', 'config', '787 MCDF opens'],
    ['man.3d-render', 'config', '3D DMC diagram renders (Ch. 21)'],
    ['man.lsapl-ground', 'config', 'LSAPL "Connected to Ground Network"'],
    ['man.airwall-request', 'config', 'Airwall request submitted for QJ'],
    ['man.sim-cap', 'hardware', 'SIM inserted and cap screwed back'],
    ['man.drive-swap', 'hardware', 'Old drive removed, 4 TB installed'],
    ['man.bios-update', 'bios', 'BIOS update run for correct variant'],
    ['man.supervisor-pw', 'bios', 'Supervisor password set'],
    ['man.rfid', 'register', 'RFID tag applied and scanned'],
    ['man.central', 'register', 'Added to Central (EID = asset tag, Gallery Type 1)'],
  ] as const
).map(([id, stage, label]) => ManualItem.parse({ id, stage, label }));
