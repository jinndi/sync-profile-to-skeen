## Синхронизация профиля из GUI.for.SingBox в SKeen

🇷🇺 **Русский** | [🇺🇸 English](README.md)

Генерирует конфигурацию sing-box для SKeen на основе профиля GUI.for.SingBox, включая необходимые входящие компоненты (**redirect-in** / **tproxy-in**).


<img width="695" height="550" alt="edit" src="https://github.com/user-attachments/assets/0a876bc1-a1d8-4a28-a760-62c3844fc763" />
<img width="695" height="454" alt="sync" src="https://github.com/user-attachments/assets/99b658f1-3cfc-48b8-ae3f-ca6e9a9dad5f" />
<img width="695" height="454" alt="main" src="https://github.com/user-attachments/assets/15a791c5-f446-418b-a4f7-517062161410" />

<br>

Ссылка на плагин:

```
https://raw.githubusercontent.com/jinndi/sync-profile-to-skeen/main/sync-profile-to-skeen.js
```

### Использование в GUI.for.SingBox:

1. Установите и запустите [GUI.for.SingBox](https://github.com/GUI-for-Cores/GUI.for.SingBox).
2. Добавьте sing-box JSON-подписку(и) в разделе **Subscriptions** (например, через [s-ui](https://github.com/alireza0/s-ui) либо [Sub-Store](https://github.com/jinndi/Sub-Store-Docker))
3. Создайте и настройте шаг за шагом профиль в разделе **Profiles**.
4. Добавьте плагин в разделе **Plugins**, используя ссылку, указанную выше.
5. Выполните сгенерированную команду через SSH в Entware или через WEB CLI (parse).
6. Перезапустите SKeen с помощью команды SSH `skeen restart` или через WEB CLI `exec skeen restart`.


#### Q: В Linux приложение GUI.for.SingBox падает при запуске с ошибкой `SIGSEGV: segmentation violation` (в логах `cgo` или `_Cfunc_gtk_main`). Как исправить?

**A:** Это известная проблема совместимости графического движка WebKitGTK, проприетарного драйвера **NVIDIA (версии 535+)** и старых видеокарт (например, GTX 750 Ti) в современных дистрибутивах (Ubuntu 24.04+). Рендеринг интерфейса пытается использовать аппаратный контекст EGL, что приводит к падению.

Для решения проблемы необходимо принудительно переключить WebKit на софтверный рендеринг через встроенную графику Mesa, скрыв от него драйвер NVIDIA. 

Создайте bash-скрипт для запуска приложения (например, `start.sh`):

```bash
#!/bin/bash
export __EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/50_mesa.json 
/путь_к_папке/GUI.for.SingBox
```

Сделайте скрипт исполняемым (chmod +x start.sh) и запускайте приложение через него.
