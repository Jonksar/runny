# runny 
**Vibe code while running.**

Going outside was supposed to help. Runny connects your phone's microphone and headphones to **Codex voice chat**.

## How to aura farm while running
1. Start runny - this gives you a link
2. Connect your phone to runny
   * Connect to Tailscale VPN
   * Go to the proxy link given by runny
   * "Start voice"
3. Write code while running

[Setup](#setup)

## Setup

Requirements: 
* Node.js 22+
* Recent Codex installation signed in.
* Tailscale. (needs more details)

```sh
npm install -g github:Jonksar/runny
```

From the repository you want Codex to work in:

```sh
runny doctor
runny
tailscale serve --bg 8765
```

Keep the computer awake and connected. Use headphones and keep the phone page open.

