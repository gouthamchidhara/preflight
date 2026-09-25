# Phase 0 — UMD laptop day

Goal: capture real values into `golden/manifest.json`. The probe is **read-only** and changes nothing.

## Setup
1. Dock the laptop, plug in AC, and log in with your domain account (needs local admin).
2. VS Code → **Clone Repository** → `gouthamchidhara/preflight` (no git? GitHub → Code → Download ZIP).
3. Don't install Node or pnpm on the UMD. Today needs only PowerShell.
4. Open **PowerShell as Administrator** in the repo folder.

## Baseline
5. `powershell -ExecutionPolicy Bypass -File .\scripts\probe\probe.ps1 -Label baseline`
6. If the script is blocked: open `probe.ps1` in **PowerShell ISE (Admin)** → F5.
7. Read the `SUMMARY.txt` it prints (model, serial, BIOS, OS build, disks).

## Before / after (finds where each setting lives)
8. Display: probe `-Label before-display` → Intel GCC Scale Stretched + 1920×1080 → probe `-Label after-display`.
9. Firefox: probe `-Label before-ff` → MCDF PDF = Adobe Acrobat + plugin Always Activate → probe `-Label after-ff`.
10. APN: probe `-Label before-apn` → add APN `AA FirstNet` / `32871.fn` → probe `-Label after-apn`.
11. SIM + 4 TB: probe `-Label before-hw` → power off, swap → power on → probe `-Label after-hw`.
12. Compare: VS Code → right-click file A → **Select for Compare** → right-click file B → **Compare with Selected**.

## Capture by hand
13. Save the buildstats page for this QJ (Ctrl+S). Get a green, a red and an in-progress row if you can.
14. UMD Tools → Check Conformance → screenshot it → click **View Report** and note where it saves.
15. Note the LSAPL log folder and any error text. **Never copy passwords.**
16. Take a photo of the BIOS screens (model, BIOS version, boot order).

## Ask people
17. Network team: ground-network host and port for the reachability check.
18. IT: can UMD computer accounts read the NAS share (wallpaper, BIOS packages)?
19. Identity team: Entra tenant ID + client ID for app registration.
20. Security: is there an approved secret store (Key Vault) for LSAPL values?

## After
21. Copy `C:\PreflightProbe\*.probe.zip` to your dev machine. **Don't commit the zips** (serials, hostnames).
22. Replace the `TBD(P0-x)` values in `golden/manifest.json` using the probe output, then commit.
23. Delete `C:\PreflightProbe` from the UMD when done.
