## Sync profile from GUI.for.SingBox to SKeen
<h6 align="center">
Generates an Entware sing-box (SKeen) configuration from a GUI.for.SingBox profile, including required inbound components (redirect-in / tproxy-in) and the Zashboard panel
</h6>

Plugin link:

```
https://raw.githubusercontent.com/jinndi/sync-profile-to-skeen/main/sync-profile-to-skeen.js
```

### Usage with GUI.for.SingBox

1. Install and run https://github.com/GUI-for-Cores/GUI.for.SingBox
2. Add proxy subscription(s) in the `Subscriptions` section
3. Create and configure a profile step by step in the `Profiles` section
4. Add the plugin using the link provided above in the `Plugins` section
5. Run the generated command (`curl`) via SSH in Entware
6. Make sure the `sub_config` parameter is enabled in the SKeen configuration file `skeen.json`
7. Restart SKeen using the command `skeen restart`
