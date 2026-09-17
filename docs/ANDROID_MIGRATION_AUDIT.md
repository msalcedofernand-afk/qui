# Auditoría y plan de migración Android

## Resultado de la auditoría

El proyecto actual no es una web autónoma convertida en APK. Está dividido en tres piezas:

| Pieza | Estado actual | Riesgo de migración |
| --- | --- | --- |
| `web/` | Panel responsive con Resumen, Operación, Rendimiento, Aplicaciones, Terminal Minecraft, Acceso y Auditoría | Bajo: se conserva dentro del WebView |
| `server/` | Node.js, SQLite, sesiones, CSRF, SSE, perfiles, métricas, RCON y políticas de red | Alto: no se ejecuta dentro de Android por defecto |
| `android/` | WebView hacia `127.0.0.1:3000`, foreground service, arranque tras boot y RootHelper KernelSU | Medio: dependía de un token compilado y de un backend externo |

No se localizaron módulos ni rutas de documentos, firma digital/electrónica, carga de archivos, plantillas firmables, usuarios firmantes ni validación de firmas. Tampoco hay SMS, Telegram, SSH o ADB remoto implementados; solo existen planes documentales para esas funciones.

## Funciones que conserva `nueva-version.apk`

- Inicio de sesión contra el backend mediante token y sesión HttpOnly/CSRF.
- Estado en vivo del dispositivo, RAM, CPU, temperatura, red LAN/Tailscale y Minecraft.
- Activación y restauración de perfiles.
- Cola RootBroker con operaciones tipadas, claim y resultado.
- Foreground service, WakeLock para Minecraft y arranque después de reiniciar Android.
- Listado de aplicaciones protegidas/candidatas.
- Terminal Minecraft limitada a RCON; no es una shell Android.
- Direcciones del panel/Crafty/Minecraft.
- Autorización y revocación de dispositivos.
- Auditoría y eventos SSE.
- Inspector beta de UI y descarga local de sus reportes JSONL.

## Cambio aplicado en esta versión

- `CONTROL_TOKEN` ya no se incluye en `BuildConfig` ni en el código del APK.
- El primer arranque muestra configuración de URL del backend y token.
- URL y token se almacenan cifrados con AES-GCM usando una clave Android Keystore.
- La URL se puede cambiar desde el botón `Conexión` del panel.
- El RootBroker toma endpoint y token del mismo almacén seguro.
- El identificador Android pasa a `com.redmicontrol.plane`, versión `1.0.0`, código `4`.
- La copia de seguridad Android queda desactivada para no exportar las preferencias de conexión.

## Arquitectura recomendada para una migración 100% autónoma

La mejor ruta para no perder funciones es incremental:

1. Mantener Node/Crafty/RCON como backend de compatibilidad y validar este APK híbrido en el Redmi.
2. Desactivar `LEGACY_ROOT_EXECUTOR=0` y dejar Android como único ejecutor KernelSU después de probar rollback y reinicio.
3. Crear una interfaz de dominio compartida con contratos versionados para `profile.apply`, `service.start`, `service.stop`, `network.enable` y `remote.lease`.
4. Portar primero el almacenamiento JSON/SQLite y las sesiones a un servicio Kotlin local. Mantener temporalmente los mismos endpoints `/api/*` para que el panel no cambie.
5. Portar RCON y el ping Minecraft con pruebas de timeout, reconexión y respuestas grandes.
6. Portar métricas, detección LAN/Tailscale y adaptadores Crafty/servicios.
7. Sustituir el servidor Node solo cuando la matriz de endpoints y las pruebas de recuperación estén verdes.
8. Añadir emparejamiento temporal, tokens revocables y TLS/Tailscale antes de abrir acceso remoto.

### Alternativa funcional si alguna capacidad no puede portarse

El APK debe conservar un modo `Backend externo`: si el servicio nativo no soporta una capacidad, la app sigue apuntando al Node existente por LAN/Tailscale. Así no se pierden RCON, Crafty, SQLite, perfiles ni auditoría durante la transición. No se debe reemplazar el backend hasta tener pruebas de equivalencia.

## Funciones fuera de alcance actual y sustitutos

| Función solicitada | Evidencia en el repositorio | Alternativa segura |
| --- | --- | --- |
| Documentos | No hay modelos, rutas ni almacenamiento | Añadir módulo separado con Storage cifrado, MIME allowlist y exportación controlada |
| Firmas | No hay claves, flujo de firma ni verificación | Android Keystore + firma de hash del documento y verificación en backend |
| SMS | Solo está en `REMOTE_ACCESS_PLAN.md` | No activar hasta implementar remitente permitido, nonce, expiración y comandos tipados |
| Telegram | Solo está planificado | Bot con allowlist de chats y la misma cola RootBroker |
| SSH/ADB | Solo están planificados | Lease temporal sobre Tailscale, clave pública y revocación automática |

## Criterios de aceptación antes de llamarlo autónomo

- Arranca sin Termux/Node y sirve todos los endpoints necesarios localmente.
- Los datos existentes se migran a SQLite sin perder perfiles, estado, accesos ni auditoría.
- RCON, SSE, rollback, arranque/parada y recuperación tras reinicio pasan pruebas equivalentes.
- Ningún secreto queda en recursos, JavaScript, `BuildConfig` o logs.
- Las capacidades no portadas siguen funcionando mediante `Backend externo`.
- Se generan APK firmado de release y checksum SHA-256.
