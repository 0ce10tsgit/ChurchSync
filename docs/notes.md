# Firewall setup

Fedora's firewall (firewalld) blocks incoming connections by default. Run these
once per machine so ChurchSync can accept traffic.

> **Port is a placeholder.** `47474` is the default we plan to use. Update this
> file when the transport is built and the real port is settled.

## Which machine needs what

| Machine | Opens | Why |
|---|---|---|
| Broadcaster | `47474/tcp` | Receivers connect to its control channel |
| Receiver | `47474/udp` | Incoming audio packets |

If a machine runs both roles, open both.

## Fedora (firewalld)

Broadcaster:

```bash
sudo firewall-cmd --permanent --add-port=47474/tcp
sudo firewall-cmd --reload
```

Receiver:

```bash
sudo firewall-cmd --permanent --add-port=47474/udp
sudo firewall-cmd --reload
```

`--permanent` keeps the rule after a reboot. `--reload` applies it now.

### Check it worked

```bash
sudo firewall-cmd --list-ports
```

You should see the port in the output.

### Remove it later

```bash
sudo firewall-cmd --permanent --remove-port=47474/tcp
sudo firewall-cmd --reload
```

## Only allow the church network (optional)

By default the rule above opens the port on every network the machine joins.
To restrict it to one subnet (example: `192.168.1.0/24`):

```bash
sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="192.168.1.0/24" port port="47474" protocol="tcp" accept'
sudo firewall-cmd --reload
```

Use `protocol="udp"` for the receiver.

## Windows (broadcaster, debug)

Windows Defender Firewall asks the first time the broadcaster listens:
"Allow node.exe on these networks?" Tick **Private networks** only and allow it.
Choosing Cancel or Public only blocks receivers, with no error in the app.

To set it up by hand instead, in an administrator PowerShell:

```powershell
New-NetFirewallRule -DisplayName "ChurchSync" -Direction Inbound -Protocol TCP -LocalPort 47474 -Action Allow -Profile Private -RemoteAddress LocalSubnet
```

The network must be marked **Private** (Settings > Network & internet) or the
rule won't apply. Remove it later with:

```powershell
Remove-NetFirewallRule -DisplayName "ChurchSync"
```

## Other distros

- **Ubuntu / Debian (ufw):** `sudo ufw allow 47474/tcp` (or `/udp`)
- **No firewall running:** nothing to do.

## Troubleshooting

- **Receiver can't connect:** on the broadcaster, confirm the port is listed in
  `sudo firewall-cmd --list-ports`, and that both machines are on the same subnet.
- **Can't connect at all:** the broadcaster's TCP port is blocked. On Windows,
  check the firewall prompt was allowed for Private networks.
- **Connects but no audio:** the receiver's UDP port is probably still closed.
- **Wi-Fi guest networks** often block device-to-device traffic. Use the main
  network or wired Ethernet.
