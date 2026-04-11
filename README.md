## Profile Sync from GUI.for.SingBox to SKeen

🇺🇸 **English** | [🇷🇺 На русском](README-RU.md)

Generates a sing-box configuration for SKeen based on a GUI.for.SingBox profile, including the necessary inbound components (**redirect-in** / **tproxy-in**) and the **Zashboard** panel.

<img width="466" height="415" alt="SKeen Sync" src="https://github.com/user-attachments/assets/f346d5bc-913e-45e1-ade1-046510197a02" />

Plugin link:

```
https://raw.githubusercontent.com/jinndi/sync-profile-to-skeen/main/sync-profile-to-skeen.js
```

### Usage in GUI.for.SingBox:

1. Install and run [GUI.for.SingBox](https://github.com/GUI-for-Cores/GUI.for.SingBox).
2. Add JSON subscription(s) in the **Subscriptions** section (for example, via [s-ui](https://github.com/alireza0/s-ui)). To use other subscription types, including those that require HWID, first install the `plugin-node-convert` plugin from the **Plugin Center** within the app.
3. Create and configure your profile step-by-step in the **Profiles** section.
4. Add the plugin in the **Plugins** section using the link provided above.
5. Execute the generated command via SSH in Entware or via the router's WEB CLI (using the `parse` button).
6. Ensure that the `"sing_config.enable"` parameter is set to `1` in the SKeen configuration (`skeen.json`).
7. Restart SKeen using the SSH command `skeen restart` or via the WEB CLI `exec skeen restart`.
