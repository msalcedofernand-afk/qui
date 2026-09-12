# Reglas De Seguridad

## Root

- Solo los perfiles pueden solicitar `suspend`, `unsuspend` y `force-stop`.
- La terminal nunca se convierte en root arbitrario.
- Se rechazan paquetes protegidos aunque lleguen desde un perfil editado.
- Cada cambio de perfil se registra en auditoría.
- Governor, hotspot, SMS y servicios tienen adaptadores independientes; no se reutiliza el ejecutor de paquetes.

## Lista blanca permanente

Android, System UI, launcher, telefonía, ajustes, teclado, red, almacenamiento, Bluetooth, NFC, Play Services, WebView, Play Store, Tailscale, Termux y KernelSU no se suspenden en perfiles de servidor.

## Recuperación

El perfil Normal debe restaurar suspensiones anteriores antes de activar sus propias reglas. Si una operación falla, se conserva la conectividad y se registra el error para rollback manual.
