# Redmi Control Plane

Control plane local-first para un Redmi Note 9 Pro con KernelSU, Crafty y Minecraft.

## Ejecutar el panel

```powershell
$env:ADMIN_TOKEN = "cambia-este-token"
npm start
```

Abrir `http://localhost:3000`. El panel pide el token una vez y lo guarda en `localStorage`.

Variables útiles:

- `PORT`: puerto HTTP, por defecto `3000`.
- `PUBLIC_HOST`: dirección que se muestra para compartir Minecraft.
- `MC_PORT`: puerto Minecraft, por defecto `25565`.
- `MC_LOG`: ruta al `latest.log` de Paper.
- `ROOT_CONTROL_ENABLED=1`: activa el adaptador root real cuando esté instalado en Android. En desarrollo queda simulado.

`ADMIN_TOKEN` es obligatorio y debe tener al menos 16 caracteres. Para compilar la app con el token local sin guardarlo en Git:

```powershell
cd android
.\gradlew.bat assembleDebug -PCONTROL_TOKEN="token-local-del-dispositivo"
```

## Android

El proyecto Compose está en `android/`. Genera el launcher con WebView, foreground service, WakeLock durante Minecraft y arranque tras reinicio. La integración KernelSU actual admite detener/suspender/restaurar paquetes de una lista controlada; los adaptadores de CPU y servicios siguen deshabilitados hasta validar el kernel y consolidar el `RootBroker`.

Consulta `docs/REMOTE_ACCESS_PLAN.md` antes de habilitar SSH, SMS, Telegram o ADB remoto.

## AgentRail

AgentRail se mantiene como plano externo de desarrollo. El repositorio actual no contiene sus fuentes ni se instala en el Redmi.
