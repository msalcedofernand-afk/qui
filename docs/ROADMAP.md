# Hoja de ruta técnica

## Objetivo

Dejar el control del dispositivo con un único ejecutor root, recuperación segura, secretos fuera del APK y acceso remoto limitado a la tailnet.

## Etapa 1: Rollback transaccional

1. Registrar antes de cada cambio el estado real del paquete (`suspendido`, `detenido o desconocido`).
2. Guardar ese estado dentro de la operación del perfil.
3. Si una acción falla, revertir las acciones ya ejecutadas en orden inverso.
4. Marcar la operación como `failed` solo después del rollback.
5. Confirmar `activeProfile` únicamente con resultado exitoso.

Aceptación: una activación parcialmente fallida deja el perfil anterior activo y restaura los paquetes modificados.

## Etapa 2: RootBroker único

1. Convertir cada cambio root en un comando tipado e idempotente.
2. Hacer que Android sea el único ejecutor de paquetes, CPU y servicios.
3. Añadir `accepted`, `running`, `succeeded`, `failed` y `expired` como estados públicos.
4. Añadir nonce, broker ID, reintento limitado y timeout.
5. Desactivar `LEGACY_ROOT_EXECUTOR` por defecto en producción.
6. Eliminar `rootAction()` cuando las pruebas de recuperación pasen.

Aceptación: Node nunca ejecuta comandos root y una operación no puede ejecutarse dos veces.

## Etapa 3: Secretos y emparejamiento

1. Eliminar `CONTROL_TOKEN` de `BuildConfig` y del JavaScript.
2. Generar un secreto durante la primera instalación.
3. Guardarlo usando Android Keystore.
4. Añadir emparejamiento con código de un solo uso y vencimiento.
5. Emitir tokens por dispositivo con rol, vencimiento y revocación.
6. Rotar el secreto bootstrap después del emparejamiento.

Aceptación: extraer el APK no permite autenticarse en la API.

## Etapa 4: Red y API

1. Permitir panel y broker solo por localhost o Tailscale.
2. Rechazar peticiones externas aunque conozcan el token.
3. Añadir rate limiting para sesión, dispositivos y comandos RCON.
4. Añadir cabeceras CSP y protección de framing.
5. Evitar devolver detalles internos en errores de producción.

Aceptación: el panel no queda expuesto a una interfaz no autorizada y los intentos abusivos se limitan.

## Etapa 5: Servicios y Minecraft

1. Completar adaptadores tipados para Crafty, Paper, SSH y Tailscale.
2. Implementar rollback de servicios iniciados durante una transición fallida.
3. Reducir las consultas RCON periódicas y mantenerlas locales.
4. Añadir pruebas de ping, arranque, parada y timeout.
5. No guardar respuestas RCON completas en auditoría.

Aceptación: los estados del panel reflejan el estado real después de reinicios y pérdida de red.

## Etapa 6: Pruebas y operación

1. Pruebas de concurrencia del claim.
2. Pruebas de expiración y reintentos.
3. Pruebas de rollback de perfiles.
4. Pruebas de pérdida de red y reinicio Android.
5. Pruebas manuales KernelSU en el Redmi.
6. Documentar backup/restauración de SQLite y recuperación de emergencia.

## Orden de ejecución

`rollback → RootBroker → secretos → red/API → servicios → pruebas finales`

Cada etapa debe mantener `npm test` en verde antes de pasar a la siguiente.
