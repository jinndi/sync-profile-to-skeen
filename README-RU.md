## Синхронизация профиля из GUI.for.SingBox в SKeen

🇷🇺 **Русский** | [🇺🇸 English](README.md)

Генерирует конфигурацию sing-box для SKeen на основе профиля GUI.for.SingBox, включая необходимые входящие компоненты (**redirect-in** / **tproxy-in**) и панель **Zashboard**.

<img width="466" height="415" alt="SKeen Sync" src="https://github.com/user-attachments/assets/f346d5bc-913e-45e1-ade1-046510197a02" />

Ссылка на плагин:

```
https://raw.githubusercontent.com/jinndi/sync-profile-to-skeen/main/sync-profile-to-skeen.js
```

### Использование в GUI.for.SingBox:

1. Установите и запустите [GUI.for.SingBox](https://github.com/GUI-for-Cores/GUI.for.SingBox).
2. Добавьте JSON-подписку(и) в разделе **Subscriptions** (например, через [s-ui](https://github.com/alireza0/s-ui)). Чтобы использовать другие типы подписок, включая те, что требуют HWID, предварительно установите плагин `plugin-node-convert` из раздела **Центр плагинов** в приложении.
3. Создайте и настройте шаг за шагом профиль в разделе **Profiles**.
4. Добавьте плагин в разделе **Plugins**, используя ссылку, указанную выше.
5. Выполните сгенерированную команду через SSH в Entware или через WEB CLI (parse).
6. Убедитесь, что в конфигурации SKeen (`skeen.json`) параметр `"sing_config.enable"` установлен в значение `1`.
7. Перезапустите SKeen с помощью команды SSH `skeen restart` или через WEB CLI `exec skeen restart`.
