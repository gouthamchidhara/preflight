# Laptop day: one-liners

Everything the agent does is **read-only** except fixes you click. Nothing needs Node on the UMD.

## Before (dev PC)
1. Merge the branch into `main` (or switch to `claude/inspiring-bohr-rfl4wy`).
2. GitHub → **Actions** → latest green **ci** run → download artifact **preflight-agent-win-x64** (zip).
3. No green run? On any Windows PC with Node 22: `pnpm install; powershell -File apps\agent\installer\build-exe.ps1`.
4. Copy the zip to a USB stick or share.

## On the UMD (docked, AC, Administrator PowerShell)
5. Unzip to `C:\Preflight` and `cd C:\Preflight`.
6. `.\PreflightAgent.exe check` → prints PASS/FAIL per check and saves a JSON report (path shown at the end).
7. `.\PreflightAgent.exe check --stage hardware` → just the SIM + 4 TB checks.
8. `powershell -ExecutionPolicy Bypass -File .\probe.ps1 -Label baseline` → full snapshot for the golden values.
9. Blocked by policy? Open the `.ps1` in **PowerShell ISE (Admin)** → F5.

## Before / after each manual step
10. Display: probe `-Label before-display` → Intel GCC Stretched + 1920×1080 → probe `-Label after-display`.
11. Firefox: probe `-Label before-ff` → PDF = Adobe Acrobat + Always Activate → probe `-Label after-ff`.
12. APN: probe `-Label before-apn` → add `AA FirstNet` / `32871.fn` → probe `-Label after-apn`.
13. SIM + 4 TB: `.\PreflightAgent.exe check --stage hardware` → power off, swap → power on → same command again.
14. Compare two probe files in VS Code: right-click A → **Select for Compare** → right-click B → **Compare with Selected**.

## Optional: see it on the dashboard
15. Dev PC (same network): `pnpm install; pnpm build; pnpm demo` → open `http://localhost:3000`.
16. UMD: `.\install.ps1 -Server http://<dev-pc-name>:3000 -Token demo-bootstrap-token-change-me`.
17. The laptop appears within ~2 min; click **Run all checks** for an instant run.
18. Only click **Run fix** on things you'd fix by hand anyway (each fix backs up first).
19. Done testing: `.\uninstall.ps1 -Purge`.

## Capture by hand
20. Save the buildstats page for this QJ (Ctrl+S): green, red and in-progress rows if you can.
21. UMD Tools → Check Conformance → screenshot → **View Report** → note where it saves.
22. LSAPL log folder + any error text. **Never copy passwords.**
23. Photo of the BIOS screens (version, boot order).

## Ask people
24. Network team: ground-network host:port.
25. IT: can UMD computer accounts read the NAS share?
26. Identity team: Entra tenant ID + app registrations (see HOSTING.md).
27. Server owner: where Preflight will be hosted (see HOSTING.md).

## After
28. Send me the `check` JSON + probe `SUMMARY.txt` files. I'll fill `golden/manifest.json`, and TBD checks turn into real pass/fail.
29. Don't commit probe zips (serials, hostnames).
