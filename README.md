# Redmi Control Plane

Control plane local-first para un Redmi Note 9 Pro con KernelSU, Crafty y Minecraft.

## Ejecutar el panel

```powershell
$env:ADMIN_TOKEN = "cambia-este-token"
npm start
```

Abrir `http://localhost:3000`. El panel intercambia el token por una sesión `HttpOnly` y conserva el CSRF solo en memoria.

Variables útiles:

- `PORT`: puerto HTTP, por defecto `3000`.
- `PUBLIC_HOST`: dirección que se muestra para compartir Minecraft.
- `MC_PORT`: puerto Minecraft, por defecto `25565`.
- `MC_LOG`: ruta al `latest.log` de Paper.
- `RCON_PASSWORD_FILE`: archivo `0600` con la contraseña RCON local.
- `RCON_HOST` / `RCON_PORT`: por defecto `127.0.0.1:25575`.
- `LEGACY_ROOT_EXECUTOR=0`: entrega los cambios de perfil al RootBroker Android mediante SQLite + SSE.
- `ROOT_CONTROL_ENABLED=1`: activa el adaptador root real cuando esté instalado en Android. En desarrollo queda simulado.

Para preparar una instalación, copia `.env.example` a un archivo de entorno privado y cambia todos los valores `replace-*`. No guardes tokens ni contraseñas en Git. El archivo de contraseña RCON debe tener permisos `0600`.

`ADMIN_TOKEN` es obligatorio y debe tener al menos 16 caracteres. Durante la transición, el APK recibe el secreto por Gradle local; la siguiente fase lo reemplaza por bootstrap con Keystore antes de habilitar SMS, Telegram o SSH:

```powershell
cd android
.\gradlew.bat assembleDebug -PCONTROL_TOKEN="token-local-del-dispositivo"
```

El artefacto versionado se encuentra en `releases/redmi-control-debug.apk`.

## Android

En Codespaces, este proyecto usa Java 21. El `devcontainer` lo selecciona para evitar que Gradle tome Java 25, que no es compatible con Gradle 8.9. Si el contenedor ya estaba abierto antes de añadir esta configuración, reconstruye el Codespace con **Rebuild Container** y verifica:

```bash
java -version
cd android
./gradlew assembleDebug
```

El proyecto Compose está en `android/`. Genera el launcher con WebView, foreground service, WakeLock durante Minecraft y arranque tras reinicio. La integración KernelSU actual admite detener/suspender/restaurar paquetes de una lista controlada; los adaptadores de CPU y servicios siguen deshabilitados hasta validar el kernel y consolidar el `RootBroker`.

Consulta `docs/REMOTE_ACCESS_PLAN.md` antes de habilitar SSH, SMS, Telegram o ADB remoto.

## AgentRail

AgentRail se mantiene como plano externo de desarrollo. El repositorio actual no contiene sus fuentes ni se instala en el Redmi.
