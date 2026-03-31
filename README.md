# Share configuration from GUI.for.SingBox to SKeen
<h3 align="center">
Generates a configuration for the Entware sing-box (SKeen), automatically adding the necessary incoming traffic components (redirect-in/tproxy-in) + Zashboard panel
</h3>

Plugin link:

```
https://raw.githubusercontent.com/jinndi/plugin-share-profile-to-skeen/main/plugin-share-profile-to-skeen.js
```

### Usage with GUI.for.SingBox

1. Install and run https://github.com/GUI-for-Cores/GUI.for.SingBox
2. Add proxy subscription(s) in the `Subscriptions` section
3. Create and configure a profile step by step in the `Profiles` section
4. Add the plugin using the link provided above in the `Plugins` section
5. Run the generated command (`curl`) via SSH in Entware
6. Make sure the `sub_config` parameter is enabled in the SKeen configuration file `skeen.json`
7. Restart SKeen using the command `skeen restart`
