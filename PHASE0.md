# Tomorrow on the UMD

```mermaid
flowchart TD
  A["💻 Dev PC<br/>GitHub → Actions → download<br/><b>preflight-agent-win-x64</b> zip"] --> B["🔌 UMD: docked, on AC<br/>unzip to C:\Preflight<br/>open PowerShell as Admin"]
  B --> C["▶️ <b>.\PreflightAgent.exe check</b><br/>PASS / FAIL for every check"]
  B --> D["📸 <b>.\probe.ps1 -Label baseline</b><br/>snapshot of everything"]
  C --> E["🔧 SIM + 4 TB swap<br/>run <b>check --stage hardware</b><br/>before and after"]
  D --> E
  E --> F["📤 Send me:<br/>check JSON + probe SUMMARY.txt"]
```

| Tool | Tells you |
|---|---|
| `PreflightAgent.exe check` | **Is the laptop ready?** (PASS / FAIL) |
| `probe.ps1` | **What's on the laptop?** (raw values for me) |

- Both only read. Nothing changes on the laptop.
- No exe (build red)? Just run `probe.ps1` from `scripts\probe\`.
- Script blocked? Open it in **PowerShell ISE (Admin)** → F5.
