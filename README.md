## Profile Sync from GUI.for.SingBox to SKeen

🇺🇸 **English** | [🇷🇺 На русском](README-RU.md)

Generates a sing-box configuration for SKeen based on a GUI.for.SingBox profile, including the necessary inbound components (**redirect-in** / **tproxy-in**).

<img width="695" height="550" alt="edit" src="https://github.com/user-attachments/assets/0a876bc1-a1d8-4a28-a760-62c3844fc763" />
<img width="695" height="454" alt="sync" src="https://github.com/user-attachments/assets/99b658f1-3cfc-48b8-ae3f-ca6e9a9dad5f" />
<img width="695" height="454" alt="main" src="https://github.com/user-attachments/assets/15a791c5-f446-418b-a4f7-517062161410" />

<br>


Plugin link:

```
https://raw.githubusercontent.com/jinndi/sync-profile-to-skeen/main/sync-profile-to-skeen.js
```

### Usage in GUI.for.SingBox:

1. Install and run [GUI.for.SingBox](https://github.com/GUI-for-Cores/GUI.for.SingBox).
2. Add sing-box JSON subscription(s) in the **Subscriptions** section (e.g., via [s-ui](https://github.com/alireza0/s-ui) or [Sub-Store](https://github.com/jinndi/Sub-Store-Docker))
3. Create and configure your profile step-by-step in the **Profiles** section.
4. Add the plugin in the **Plugins** section using the link provided above.
5. Execute the generated command via SSH in Entware or via the router's WEB CLI (using the `parse` button).
6. Restart SKeen using the SSH command `skeen restart` or via the WEB CLI `exec skeen restart`.

#### Q: On Linux, the GUI.for.SingBox application crashes on startup with a `SIGSEGV: segmentation violation` error (pointing to `cgo` or `_Cfunc_gtk_main` in logs). How to fix this?

**A:** This is a known compatibility issue between the WebKitGTK engine, proprietary **NVIDIA drivers (v535+)**, and legacy GPU architectures (like Maxwell/GTX 750 Ti) on modern Linux distributions (e.g., Ubuntu 24.04). The interface renderer fails when initializing the hardware EGL context.

To fix this, you need to force WebKit to use software rendering via Mesa by isolating it from the NVIDIA EGL vendor library.

Create a wrapper bash script (e.g., `start.sh`) to launch the app:

```bash
#!/bin/bash
export __EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/50_mesa.json 
/path_to_app/GUI.for.SingBox
```

Make the script executable (chmod +x start.sh) and use it to run the application.
