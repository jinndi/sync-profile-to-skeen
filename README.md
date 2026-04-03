## Sync profile from GUI.for.SingBox to SKeen
Generates an Entware sing-box (SKeen) configuration from a GUI.for.SingBox profile, including required inbound components (redirect-in / tproxy-in) and the Zashboard panel

<img width="466" height="415" alt="SKeen Sync" src="https://github.com/user-attachments/assets/f346d5bc-913e-45e1-ade1-046510197a02" />

Plugin link:

```
https://raw.githubusercontent.com/jinndi/sync-profile-to-skeen/main/sync-profile-to-skeen.js
```

### Usage with GUI.for.SingBox:

1. Install and run https://github.com/GUI-for-Cores/GUI.for.SingBox
2. Add JSON subscription(s) in the `Subscriptions` section (for example via [s-ui](https://github.com/alireza0/s-ui))
3. Create and configure a profile step by step in the `Profiles` section
4. Add the plugin using the link provided above in the `Plugins` section
5. Run the generated command via SSH in Entware or WEB CLI (parse)
6. Make sure the `sing_config.enable` set to 1 in the SKeen configuration (`skeen.json`)
7. Restart SKeen using the command SSH `skeen restart` or WEB CLI `exec skeen restart`
