# Plan De Acceso Remoto

## Estado Actual

- Paper, Crafty, el panel, Tailscale y el servicio Android funcionan en el dispositivo.
- Tailscale se detecta dinámicamente desde la interfaz de red disponible; no se debe asumir una IP fija.
- OpenSSH está instalado en Alpine, pero no está provisionado ni iniciado.
- La app recibe cambios por SSE; no realiza el antiguo sondeo root cada cinco segundos.
- Persisten dos ejecutores root, un token bootstrap incrustado, métricas Minecraft parciales y adaptadores root sin implementar.

## Fase 1: RootBroker Único

1. Crear comandos tipados: `profile.apply`, `service.start`, `service.stop`, `network.enable` y `remote.lease`.
2. Guardarlos en una cola local con ID, nonce, vencimiento y estado.
3. Hacer que Android sea el único ejecutor KernelSU y responda con `accepted`, `running`, `succeeded` o `failed`.
4. Confirmar red, launcher y servicio de control antes de consolidar una transición.
5. Guardar el estado real de cada paquete para rollback exacto.
6. Retirar `rootAction()` de Node cuando las pruebas de reinicio y pérdida de red pasen.

## Fase 2: Identidad Y Secretos

1. Generar el secreto propietario en la primera instalación y almacenarlo cifrado con Android Keystore.
2. Eliminar el token fijo del launcher, JavaScript y script de arranque.
3. Emparejar dispositivos con código de un solo uso; emitir tokens revocables con rol y vencimiento.
4. Autorizar por identidad Tailscale y token. No usar MAC: no cruza Internet y puede cambiar; una IP puede reasignarse.
5. Aplicar rate limiting, tamaño máximo de petición y auditoría separada del estado operativo.

## Fase 3: SSH Seguro

SSH sí puede formar parte del sistema. Se ejecutará dentro de Alpine con un usuario operativo sin privilegios, autenticación exclusiva por clave, `PermitRootLogin no`, `PasswordAuthentication no`, reenvío deshabilitado y escucha solo en localhost y la IP Tailscale. El panel podrá iniciar una sesión temporal, mostrar su vencimiento y apagarla. Nunca se publicará el puerto 22 directamente a Internet.

Antes de iniciarlo faltan: generar host keys, crear el usuario, registrar al menos una clave pública autorizada y comprobar que Tailscale está conectado. Si desaparece la tailnet, el servicio se detiene o queda inaccesible por firewall.

## Fase 4: Recuperación SMS

1. Añadir un receptor Android `directBootAware` y almacenamiento protegido del dispositivo.
2. Aceptar solo remitentes registrados y mensajes firmados con código temporal, nonce y vencimiento.
3. Limitar las órdenes a `STATUS`, `WAKE`, `REMOTE_ON`, `REMOTE_OFF` y `SERVER_STOP`.
4. `REMOTE_ON` intenta habilitar datos o Wi-Fi con APIs privilegiadas verificadas, espera conectividad y luego habilita Tailscale.
5. No aceptar shell, texto libre ni cambios de paquetes por SMS.

## Fase 5: Telegram Y Control Completo

El bot se ejecutará en Node con long polling, lista de chats permitidos y los mismos comandos tipados del `RootBroker`. Telegram sirve para estado y acciones simples cuando hay Internet; no sustituye a SMS para despertar un teléfono desconectado.

El control visual completo se habilitará como una concesión temporal: Tailscale primero, luego ADB inalámbrico por tiempo limitado y scrcpy desde un equipo autorizado. Al vencer la concesión, se desactiva ADB TCP. Para Android interactivo sin PC, una herramienta de asistencia remota requerirá permisos de captura y accesibilidad visibles para el usuario.

## Orden De Entrega

1. RootBroker, rollback y pruebas de recuperación.
2. Secretos y emparejamiento sin token fijo.
3. SSH por clave sobre Tailscale.
4. Ping Minecraft y RCON local real.
5. SMS de recuperación.
6. Bot Telegram.
7. Concesiones temporales ADB/scrcpy y pruebas Wi-Fi, 4G, reinicio y pérdida de red.
